"use strict";

import md5 from "md5";
import * as d3 from "d3";

//Width and height
let w = 600;
let h = 250;

let ROOT_3 = 1.73205080757 // Square root of 3
let ROOT_2 = 1.41421356237 // Square root of 2

let vis = new function() {
    this.graph = {
        nodes: [],
        links: []
    };

    this.svg = d3.select("body")
        .append("svg")
        .attr("width", w)
        .attr("height", h);

    this.node = this.svg.append("g")
        .attr("class", "nodes")
        .selectAll("g.node")
        .data(this.graph.nodes);

    this.link = this.svg.append("g")
        .attr("class", "links")
        .selectAll("line")
        .data(this.graph.links);

    this.onSimTick = _ => { // Use arrow function so 'this' isn't weird
        this.node
            .attr("transform", d => `translate(${d.x}, ${d.y})`)

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

    this.simulation = d3.forceSimulation(this.graph.nodes)
        .force("charge", d3.forceManyBody())
        .force("link", d3.forceLink(this.graph.links))
        .force("center", d3.forceCenter(w / 2, h / 2))
        .alphaMin(0.05)
        .on('tick', this.onSimTick)
        .on('end', this.onSimEnd);

    // Given the radius of the circumscribed circle, return the points of an
    // equilateral triangle centred on 0,0 with a vertical left side (so it
    // "points right" like a play button). Array of [x,y] pairs.
    // By what sorcery is this computed? Don't worry about it, I got an A* in
    // GCSE maths. Barely took me half an hour and a whole page of diagrams.
    this._getTrianglePoints = function(radius) {
        return [[-radius / 2, +radius * (ROOT_3 / 2)],
                [-radius / 2, -radius * (ROOT_3 / 2)],
                [+radius, 0]]
    }

    // Same as above, but it's a square.
    this._getSquarePoints = function(radius) {
        let d = radius * (1 / ROOT_2);
        return [[-d, -d], [-d, +d], [+d, +d], [+d, -d]]
    }

    this.addListen = function(listen) {
        this.graph.nodes.push(listen);

        this.node = this.node.data(this.graph.nodes, d => d.url)
            .enter().append("g")
            .classed("node", true)
            .classed("playing", false)
            .on("click", function(d) {
                console.log(`Vis playing/pausing ${d.url}`);
                let elem = d3.select(this);
                if (elem.classed("playing")) {
                    d.audio.pause();
                    elem.classed("playing", false);
                } else {
                    d.audio.play();
                    elem.classed("playing", true);
                }
            });

        let NODE_RADIUS = 25;
        this.node
            .append("circle")
            .attr("r", NODE_RADIUS)
            .merge(this.node);

        // Add two polygons - one for the play button and one for the stop
        // button. We'll use CSS to determine which one is visible.
        let BUTTON_RADIUS = Math.floor(NODE_RADIUS * 0.65);
        this.node
            .append("polygon")
            .classed("playbutton", true)
            .attr("points", this._getTrianglePoints(BUTTON_RADIUS).map(xy => xy.join(",")).join(" "))
            .style("fill", "white");

        this.node
            .append("polygon")
            .classed("stopbutton", true)
            .attr("points", this._getSquarePoints(BUTTON_RADIUS).map(xy => xy.join(",")).join(" "))
            .style("fill", "white");

        this.restartSim();
    }
}

// Not-a-class to represent a file that can be listened to on a wikipedia page
let Listen = function(page, filename) {
    this.page = page;

    // There's probably further normalisation to do here... not sure what it
    // is. I'm sure I saw that info somewhere once.
    // TODO this conversion from filename to URL should be a more coupled with
    // the wikipedia object.
    let normalizedFilename = filename.trim().replace(new RegExp(" ", "g"), "_");
    // Wikipedia enables this option, so we have to do some md5
    // jiggery-pokery:
    // https://www.mediawiki.org/wiki/Manual:$wgHashedUploadDirectory TODO
    let md5sum = md5(normalizedFilename);
    // Not exactly sure what the base URL should be, but this one seems to work...
    let baseUrl = "https://upload.wikimedia.org/wikipedia/commons"
    this.url = `${baseUrl}/${md5sum[0]}/${md5sum.slice(0, 2)}/${encodeURIComponent(normalizedFilename)}`

    console.log(`Listen(${filename.trim()}) computed URL: ${this.url}`);

    this.audio = new Audio([this.url]);
}

// Not-a-class to represent a wikipedia page
let Page = function(pageDesc, parseTree, wikipedia) {
    this.title = pageDesc.title;
    this.wikipedia = wikipedia;
    this.parseTree = parseTree
}
// Async generator to yield Pages that are linked from this one
Page.prototype.getLinkedPages = async function*() {
    // TODO: How to cache this?!

    // First make the request to get all the titles
    let links = (await this.wikipedia.request({
        action: "parse",
        page: this.title,
        prop: "links"
    }).then(response => response.json())).parse.links;

    // Now build a promise for each target Page. Store in a map keyed on title.
    let promises = new Map(links
                           .filter(link => link.exists)
                           .map(link => [link.title, wikipedia.getPageByTitle(link.title)]));

    // Now iteratively await the first resolved promise and yield the result,
    // until all are done.
    while (promises.size != 0) {
        let page = await Promise.race(promises.values());
        promises.delete(page.title);
        let listens = page.getListens();
        if (listens.length) {
            yield page;
        }
    }
}
// Promise to get an array of the files that can be listened to on this page
Page.prototype.getListens = function() {
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
    let xpathResult = this.parseTree.evaluate(xpath, this.parseTree);
    for (let filename = xpathResult.iterateNext(); filename; filename = xpathResult.iterateNext()) {
        console.log(`Page(${this.title}) found Listen: ${filename.textContent}`);
        ret.push(new Listen(this, filename.textContent));
    }
    return ret;
}

let wikipedia = new function() {
    this.urlBase = 'https://en.wikipedia.org/w/api.php';

    this._pageCache = new Map(); // Keyed by title

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
        return fetch(new Request(url, {method: "GET",
                                       mode: "cors",
                                       headers: {"Origin": "http://localhost:8080",
                                                 "Content-Type": "application/json"}}));
    }

    // Return a Promise that resolves to an array of Page objects, which all
    // contain the Listen wikipedia template in their body.
    this.getPagesWithListens = async function*() {
        let requestParams = {
            action: "query",
            generator: "embeddedin",
            geititle: "Template:Listen",
            geilimit: "max",
            prop: "templates",
            tltemplates: "Template:Listen",
            // Setting tllimit breaks things because we get a tlcontinue instead
            // of a geicontinue (i.e. it's continuing the list of templates in a
            // page instead of the list of pages). Not sure how to fix that so
            // just don't limit templates.. not sure if this will break stuff.
            // tllimit: 1
        };

        while (true) {
            let result = await this.request(requestParams)
                .then(response => response.json());

            if (result.hasOwnProperty("error")) {
                throw result.error;
            }
            if (result.hasOwnProperty("warnings")) {
                console.log(result.warnings);
            }

            for (let pageDesc of result.query.pages) {
                yield await this.getPageByTitle(pageDesc.title);
            }

            // If it couldn't return all of the pages in a single response, WP
            // puts a "continue" object in the response, if we put its
            // attributes in the request params and do it again, it will carry
            // on from where it left off.
            if (result.hasOwnProperty("continue")) {
                requestParams = Object.assign(requestParams, result.continue);
            } else {
                break;
            }
        }
    }

    this._getParseTree = async function(title) {
        let result = await this.request({
            action: "parse",
            page: title,
            prop: "parsetree"
        }).then(response => response.json())
        return new DOMParser().parseFromString(result.parse.parsetree, "text/xml");
    }

    // Look up a Page by title
    this.getPageByTitle = async function(title) {
        let page = this._pageCache.get(title);
        if (page) {
            return page;
        }

        let pageDesc = {"title": title};
        page = new Page(pageDesc, await this._getParseTree(title), this);
        this._pageCache.set(title, page);
        return page;
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

window.pages = new Set();
(async function() {
    let i = 0;
    for await (let page of wikipedia.getPagesWithListens()) {
        window.pages.add(page);
        break;
    }
    vis.addListen(window.pages.values().next().value.getListens()[0]);
})();

// Enable access from console when using webpack, for debugging
window.wikipedia = wikipedia;
window.vis = vis;
window.d3 = d3;
