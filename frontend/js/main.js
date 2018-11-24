//Width and height
let w = 600;
let h = 250;

let vis = new function() {
    this.graph = {
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

    this.svg = d3.select("body")
        .append("svg")
        .attr("width", w)
        .attr("height", h);

    this.node = this.svg.append("g")
        .attr("class", "nodes")
        .selectAll("circle")
        .data(this.graph.nodes)
        .enter().append("circle")
        .attr("r", 5);

    this.link = this.svg.append("g")
        .attr("class", "links")
        .selectAll("line")
        .data(this.graph.links)
        .enter()
        .append("line")
        .attr("stroke", "gray");

    this.onSimTick = _ => { // Use arrow function so 'this' isn't weird
        this.node
            .attr("cx", function(d) { return d.x; })
            .attr("cy", function(d) { return d.y; });

        this.link
            .attr("x1", function(d) { return d.source.x; })
            .attr("y1", function(d) { return d.source.y; })
            .attr("x2", function(d) { return d.target.x; })
            .attr("y2", function(d) { return d.target.y; });
    }

    this.restartSim = function() {
        this.simulation.nodes(this.graph.nodes);
        this.simulation.force('link').links(this.graph.links);
        this.simulation.alpha(0.5).restart();
    }

    this.done = false;
    this.onSimEnd = _ => {
        console.log('end');

        if (this.done) return;
        this.done = true;

        this.graph.nodes.push({id: "8"});
        this.graph.links.push({source: 0, target: 8});

        this.node = this.node.data(this.graph.nodes, d => { return d.id })
            .enter().append("circle")
            .attr("r", 5)
            .merge(this.node);

        this.link = this.link.data(this.graph.links, d => { [d.source.id, d.target.id].join("-") })
        this.link.exit().remove()
        this.link = this.link.enter()
            .append("line")
            .attr("stroke", "gray")
            .merge(this.link);

        this.restartSim();
    }

    this.simulation = d3.forceSimulation(this.graph.nodes)
        .force("charge", d3.forceManyBody())
        .force("link", d3.forceLink(this.graph.links))
        .force("center", d3.forceCenter(w / 2, h / 2))
        .alphaMin(0.05)
        .on('tick', this.onSimTick)
        .on('end', this.onSimEnd);
}

let wpWalker = new function() {
    this.urlBase = 'https://en.wikipedia.org/w/api.php';

    this.request = function(args) {
        args = new Map(Object.entries(args)); // Fuck this fucking language
        let parts = []
        for (let entry of args.entries()) {
            parts.push(entry.join('='))
        }
        let queryString = parts.join('&')
        let url = `${this.urlBase}?${queryString}`;
        console.log(url);
        return new Request(url, {method: "GET",
                                 mode: "cors",
                                 headers: {"Origin": "http://localhost:8080",
                                           "Content-Type": "application/json"}});
    }

    this.getPagesWithListens = function() {
        return fetch(this.request({
            origin: "*",
            action: "query",
            format: "json",
            formatversion: "2",
            generator: "embeddedin",
            geititle: "Template:Listen",
            prop: "templates",
            tltemplates: "Template:Listen",
            tllimit: 20
        }));
    }
}

// Jesus JavaScript is a pain.. OK try this: wpWalker.getPagesWithListens().then(response => { console.log(response.json().then(console.log))} )

// Then we're going to end up wanting to call something like this:  https://en.wikipedia.org/w/api.php?action=parse&format=json&page=The_Star-Spangled_Banner&prop=parsetree&formatversion=2
