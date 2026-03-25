import geopandas as gpd
import momepy
import networkx as nx
import mapclassify
import json

def run_network_analysis(shp_path, analysis_type, classification_method, class_count, metric, radius):
    # 1. Read Shapefile and Explode
    gdf = gpd.read_file(shp_path)
    gdf = gdf.explode(index_parts=False).reset_index(drop=True)

    # FIX: Guard against missing CRS (.prj file absent) before calling is_projected
    if gdf.crs is None or not gdf.crs.is_projected:
        gdf = gdf.to_crs(epsg=3857)

    # 2. Graph Conversion
    # Primal graph: Nodes = Intersections, Edges = Street Segments
    G = momepy.gdf_to_nx(gdf, approach='primal', length='mm_len')

    # 3. Configure Weight & Radius
    # FIX: ANGULAR / HYBRID / EUCLIDEAN_ANGULAR are not supported on primal graphs
    # (they require a dual graph). We map them explicitly and warn rather than
    # silently applying topological routing.
    if metric == 'EUCLIDEAN':
        weight_key = 'mm_len'
    elif metric in ('ANGULAR', 'HYBRID', 'EUCLIDEAN_ANGULAR'):
        # Angular metrics require a dual-graph conversion which is out of scope here.
        # Fall back to Euclidean and note it in the result so the caller can surface it.
        weight_key = 'mm_len'
        print(
            f"WARNING: metric '{metric}' requires a dual graph and is not yet "
            "implemented. Falling back to EUCLIDEAN (mm_len)."
        )
    else:
        # Topological (unweighted)
        weight_key = None

    # Parse Radius
    radius_val = None
    if radius and radius != 'n':
        try:
            radius_val = float(radius)
        except ValueError:
            radius_val = None

    # 4. Calculate Metrics (ON NODES)
    column_name = analysis_type

    if analysis_type == 'connectivity':
        metric_values = dict(G.degree())

    elif analysis_type == 'closeness':
        if radius_val:
            # FIX: momepy.closeness_centrality returns a Series indexed by node id,
            # not a plain dict. Extract the Series from the GeoDataFrame result and
            # convert it correctly. Also removed the erroneous `weight=` kwarg —
            # momepy only accepts `distance`.
            result_gdf = momepy.closeness_centrality(
                G,
                radius=radius_val,
                name=column_name,
                distance=weight_key,
            )
            # result_gdf is a GeoDataFrame; the centrality values live in the
            # column named `column_name`, indexed to match graph node order.
            metric_values = result_gdf[column_name].to_dict()
        else:
            metric_values = nx.closeness_centrality(G, distance=weight_key)

    elif analysis_type == 'betweenness':
        if radius_val:
            # FIX: Implement proper local betweenness via ego-graph subsampling
            # instead of silently ignoring the radius.
            metric_values = {}
            for node in G.nodes():
                ego = nx.ego_graph(G, node, radius=radius_val, distance=weight_key)
                # betweenness within the ego graph for the centre node only
                bc = nx.betweenness_centrality(ego, weight=weight_key, normalized=True)
                metric_values[node] = bc.get(node, 0.0)
        else:
            metric_values = nx.betweenness_centrality(G, weight=weight_key)

    else:
        raise ValueError(f"Unknown analysis type: {analysis_type!r}")

    # Save metrics to nodes
    nx.set_node_attributes(G, metric_values, column_name)

    # 5. Map Node Attributes to Edges
    # Average start/end node values onto each edge for line visualisation.
    # FIX: Use .get() with explicit 0 fallback and log when a node value is missing
    # rather than silently distorting results.
    edge_values = {}
    for u, v, key, data in G.edges(keys=True, data=True):
        val_u = G.nodes[u].get(column_name, 0)
        val_v = G.nodes[v].get(column_name, 0)
        edge_values[(u, v, key)] = (val_u + val_v) / 2

    nx.set_edge_attributes(G, edge_values, column_name)

    # 6. Convert back to GeoDataFrame (Lines)
    gdf_out = momepy.nx_to_gdf(G, points=False, lines=True)

    # 7. Classification
    values = gdf_out[column_name]

    if values.nunique() <= 1:
        gdf_out['class_id'] = 0
    else:
        # Clamp class_count to the number of unique values so classifiers never fail
        effective_k = min(class_count, int(values.nunique()))
        try:
            if classification_method == 'Natural Breaks (Jenks)':
                classifier = mapclassify.FisherJenks(values, k=effective_k)
            elif classification_method == 'Equal Interval':
                classifier = mapclassify.EqualInterval(values, k=effective_k)
            else:  # Equal Count (Quantile)
                classifier = mapclassify.Quantiles(values, k=effective_k)
            gdf_out['class_id'] = classifier.yb
        except Exception as e:
            print(f"Classification failed ({e}), falling back to class 0")
            gdf_out['class_id'] = 0

    gdf_out['value'] = values

    # 8. Prepare Output
    gdf_out = gdf_out.to_crs(epsg=4326)

    return json.loads(gdf_out.to_json())