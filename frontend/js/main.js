//Width and height
let w = 600;
let h = 250;

let graph = {
    nodes: [{id: "0"}, {id: "1"}, {id: "2"}, {id: "3"},
            {id: "4"}, {id: "5"}, {id: "6"}, {id: "7"}],
    links: [
        {source: 0, target: 1},
        {source: 0, target: 2},
        {source: 0, target: 3},
        {source: 1, target: 6},
        {source: 3, target: 4},
        {source: 3, target: 7},
        {source: 4, target: 5},
        {source: 4, target: 7}
    ]
};

//Create SVG element
let svg = d3.select("body")
    .append("svg")
    .attr("width", w)
    .attr("height", h);

let simulation = d3.forceSimulation(graph.nodes)
    .force("charge", d3.forceManyBody())
    .force("link", d3.forceLink(graph.links))
    .force("center", d3.forceCenter(w / 2, h / 2))
    .alphaMin(0.05)
    .on('tick', onSimTick)
    .on('end', onSimEnd);

let node = svg.append("g")
    .attr("class", "nodes")
    .selectAll("circle")
    .data(graph.nodes)
    .enter().append("circle")
    .attr("r", 5);

let link = svg.append("g")
    .attr("class", "links")
    .selectAll("line")
    .data(graph.links)
    .enter()
    .append("line")
    .attr("stroke", "gray");

function onSimTick() {
    node
        .attr("cx", function(d) { return d.x; })
        .attr("cy", function(d) { return d.y; });

    link
        .attr("x1", function(d) { return d.source.x; })
        .attr("y1", function(d) { return d.source.y; })
        .attr("x2", function(d) { return d.target.x; })
        .attr("y2", function(d) { return d.target.y; });

    console.log(simulation.alpha());
}

function restartSim() {
    simulation.nodes(graph.nodes);
    simulation.force('link').links(graph.links);
    simulation.alpha(0.5).restart();
}

var done = false;

function onSimEnd() {
    console.log('end');

    if (done) return;
    done = true;

    graph.nodes.push({id: "8"});
    graph.links.push({source: 0, target: 8});

    node = node.data(graph.nodes, d => { return d.id })
        .enter().append("circle")
        .attr("r", 5)
        .merge(node);

    link = link.data(graph.links, d => { [d.source.id, d.target.id].join("-") })
    link.exit().remove()
    link = link.enter()
        .append("line")
        .attr("stroke", "gray")
        .merge(link);

    restartSim();
}
