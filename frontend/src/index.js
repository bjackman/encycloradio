"use strict";

import md5 from "md5";
import * as d3 from "d3";

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

window.vis = vis; // Enable access from console when using webpack, for debugging

// Class to represent a wikipedia page
let Page = function(pageDesc, wikipedia) {
    this.title = pageDesc.title;
    this.wikipedia = wikipedia;
    this._parseTreePromise = null;
}
// Promise to get the parse tree of the page as an XMLDocument.
Page.prototype.getParseTree = function() {
    if (!this._parseTreePromise) {
        this._parseTreePromise = this.wikipedia.getParseTree(this.title);
    }
    return this._parseTreePromise
        .then(result => {
            return new DOMParser().parseFromString(result.parse.parsetree, "text/xml")
        });
}
// Promise to get an array of the filenames for the Listen templates in the page
Page.prototype.getListenFilenames = function() {
    return this.getParseTree()
        .then(xmlDoc => {
            let ret = []
            // This XPath expression finds template elements, then finds title
            // sub-elements and checks if their text contains "listen"
            // (converting to lowercase first).
            // Then it finds part sub-elements, which have a name sub-element
            // whose text contains "filename", then it takes the text of the value
            // sub-element.
            //
            // Basically we're finding the "foo.ogg" amd "bar.ogg" in template
            // elements that look like this one:
            //
            // <template lineStart="1">
            //    <title>listen</title>
            //    <part>
            //       <name>something</name>
            //       <equals>=</equals>
            //       <value>else</value>
            //    </part>
            //    <part>
            //       <name>filename</name>
            //       <equals>=</equals>
            //       <value>foo.ogg</value>
            //    </part>
            //    <part>
            //       <name>filename2</name>
            //       <equals>=</equals>
            //       <value>bar.ogg</value>
            //    </part>
            //    <part>
            // </template>

            let xpath = `
                //template[contains(translate(./title/text(), "LISTEN", "listen"), "listen")]
                    /part[contains(translate(name/text(), "FILENAME", "filename"), "filename")]
                        /value
                            /text()
            `;
            let xpathResult = xmlDoc.evaluate(xpath, xmlDoc);
            for (let filename = xpathResult.iterateNext(); filename; filename = xpathResult.iterateNext()) {
                ret.push(filename.textContent);
            }
            return ret;
        });
}

let wikipedia = new function() {
    this.urlBase = 'https://en.wikipedia.org/w/api.php';

    // Return a request object. Pass in an object with the key/val pairs to put
    // in the query string. The ones that are always required are inserted for you.
    this.request = function(args) {
        args = new Map(Object.entries(args)); // Fuck this fucking language
        args.set("origin", "*"); // Required for CORS
        args.set("format", "json")
        args.set("formatversion", "2") // Required for sensible return format
        let parts = []
        for (let entry of args.entries()) {
            parts.push(entry.join('='))
        }
        let queryString = parts.join('&')
        let url = `${this.urlBase}?${queryString}`;
        return new Request(url, {method: "GET",
                                 mode: "cors",
                                 headers: {"Origin": "http://localhost:8080",
                                           "Content-Type": "application/json"}});
    }

    // Return a Promise that resolves to an array of Page objects, which all
    // contain the Listen wikipedia template in their body.
    this.getPagesWithListens = function() {
        return fetch(this.request({
            action: "query",
            generator: "embeddedin",
            geititle: "Template:Listen",
            prop: "templates",
            tltemplates: "Template:Listen",
            tllimit: 20
        }))
            .then(response => response.json())
            .then(response => {
                let ret = [];
                for (let pageDesc of response.query.pages) {
                    ret.push(new Page(pageDesc, this));
                }
                return ret;
            });
    }

    // Get the parse tree for a page with a given title. You probably don't want
    // to call this directly, use Page.getParseTree instead
    this.getParseTree = function(title) {
        return fetch(this.request({
            action: "parse",
            page: title,
            prop: "parsetree"
        })).then(response => response.json())
    }

    // Given the filename of a Wikipedia asset as it would be used in the Wiki
    // text, get the URL it can be retrieved from.
    this.getUrlForFilename = function(filename) {
        // There's probably further normalisation to do here... not sure what it
        // is. I'm sure I saw that info somewhere once.
        let normalizedFilename = filename.replace(new RegExp(" ", "g"), "_")
        // Wikipedia enables this option, so we have to do some md5
        // jiggery-pokery:
        // https://www.mediawiki.org/wiki/Manual:$wgHashedUploadDirectory TODO
        let md5sum = md5(normalizedFilename);
        // Not exactly sure what the base URL should be, but this one seems to work...
        let baseUrl = "https://upload.wikimedia.org/wikipedia/commons"
        return `${baseUrl}/${md5sum[0]}/${md5sum.slice(0, 2)}/${encodeURIComponent(normalizedFilename)}`
    }
}

window.wikipedia = wikipedia; // Enable access from console when using webpack, for debugging

wikipedia.getPagesWithListens()
    .then(pages => {
        return pages[0].getListenFilenames()
    })
    .then(filenames => {
        let urls = []
        for (let filename of filenames) {
            let url = wikipedia.getUrlForFilename(filename);
            console.log(url);
            urls.push(url)
        }

        d3.select("body")
            .selectAll("audio")
            .data(filenames)
            .enter()
            .append("audio")
            .attr("controls", "")
            .attr("src", d => wikipedia.getUrlForFilename(d));
    });

// Jesus JavaScript is a pain.. OK try this: wikipedia.getPagesWithListens().then(response => { console.log(response.json().then(console.log))} )

// Then we're going to end up wanting to call something like this:  https://en.wikipedia.org/w/api.php?action=parse&format=json&page=The_Star-Spangled_Banner&prop=parsetree&formatversion=2
