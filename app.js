"use strict";
const path = require("node:path");
const fastify = require("fastify");
const { LRUCache } = require("lru-cache");
const nunjucks = require('nunjucks');
const dateFilter = require('nunjucks-date-filter');

const config = require("./config.js");
const domain = config.DOMAIN ?? "bsky.link";

const PORT = process.env.PORT || 3008;
const VALID_URLS = ["bsky.app", "staging.bsky.app"];

const debug_log = true;

const app = fastify({ logger: debug_log });

app.register(require('@fastify/static'), {
    root: path.join(__dirname, 'public')
});

app.register(require('@fastify/view'), {
    engine: { nunjucks },
    templates: [ 'views' ],
    options: {
        autoescape: true,
        onConfigure: (nun_env) => {
            nun_env.addGlobal('domain', domain);
            nun_env.addFilter('date', dateFilter);

            nun_env.addFilter('last_path', function(str) {
                return str.split('/').pop();
            });

            nun_env.addFilter('linkify_text', function(r) {
                const encoder = new TextEncoder();
                let decoder = new TextDecoder();
                const text_bytes = encoder.encode(r.text);
                const textchunks = [];
                let last_offset=0;
                if (r.facets){
                    for (const facet of r.facets){
                        textchunks.push(decoder.decode(text_bytes.slice(last_offset,facet.index.byteStart)));
                        let closeLink=false;
                        for (const f of facet.features){
                            if (f.uri){
                                textchunks.push(`<a href='${f.uri}'>`);
                                closeLink = true;
                                break;
                            }
                        }
                        textchunks.push(decoder.decode(text_bytes.slice(facet.index.byteStart,facet.index.byteEnd)));
                        last_offset=facet.index.byteEnd;
                        if (closeLink){
                            textchunks.push("</a>");
                        }
                    }
                }
                textchunks.push(decoder.decode(text_bytes.slice(last_offset)));
                return textchunks.join('');
            });
        }
    }
});
let token = "";
let auth_token_expires = new Date().getTime();
let refresh = "";

function getAuthToken () {
    app.log.info("getAuthToken called ");
    return fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            "identifier": config.HANDLE,
            "password": config.PASSWORD
        })
    })
    .then (response => {
        app.log.info("getAuthToken status:'"+response.status+"' statusText:'"+response.statusText+"';")
        return response.json().then((data) => {
            //app.log.info(data);
            if (response.status==200) {
                token = data.accessJwt;
                refresh = data.refreshJwt;
                app.log.info("getAuthToken response: token='"+token+"'; refresh='"+refresh+"';")
                auth_token_expires = new Date().getTime() + 1000 *5 * 60 * 30;
            } else {
                auth_token_expires = new Date().getTime();
            }
        })
    })
    .catch(err =>{
        //catch err 
        app.log.error(err);
    });                       
}

function refreshAuthToken () {
    if (refresh==="") {
        app.log.info("refreshAuthToken called without refresh token;");
        return getAuthToken();
    }
    app.log.info("refreshAuthToken called with: token='"+token+"'; refresh='"+refresh+"';");
    return fetch("https://bsky.social/xrpc/com.atproto.server.refreshSession", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + refresh
        }
    })
    .then (response => {
        app.log.info("refreshAuthToken status:'"+response.status+"' statusText:'"+response.statusText+"';")
        return response.json().then((data) => {
            //log(data);
            if (response.status==200) {
                token = data.accessJwt;
                refresh = data.refreshJwt;
                auth_token_expires = new Date().getTime() + 1000 *5 * 60 * 30;
                app.log.info("refreshAuthToken response: token='"+token+"'; refresh='"+refresh+"';")
            } else {
                return getAuthToken();
            }
        })
    })
    .catch(err =>{
        //catch err 
        app.log.error(err);
    });                       
}

function flattenReplies (replies, author_handle, iteration = 0) {
    // replies are nested objects of .replies, so we need to flatten them
    let all_replies = [];

    if (iteration > 20) {
        return all_replies;
    }

    if (!replies || replies.length == 0) {
        return all_replies;
    }

    for (const reply of replies) {
        if (reply?.post?.author?.handle != author_handle) {
            continue;
        }

        all_replies.push(reply);

        if (reply.replies && reply.replies.length > 0) {
            all_replies = all_replies.concat(flattenReplies(reply.replies, author_handle, iteration + 1));
        }
    }

    return all_replies;
}

const options = {
    max: 500,

    // for use with tracking overall storage size
    maxSize: 5000,
    sizeCalculation: (value, key) => {
        return 1
    },

    // how long to live in ms
    ttl: 1000 * 60 * 5,

    // return stale items before removing from cache?
    allowStale: false,

    updateAgeOnGet: false,
    updateAgeOnHas: false,
}

const cache = new LRUCache(options);

app.get("/", async (req, res) => {
    if (new Date().getTime() > auth_token_expires) {
        await refreshAuthToken();
    }

    const url = req.query.url;
    let parsed_url;

    if (!url) {
        // show home
        return res.view("home.njk");
    }

    try {
        parsed_url = new URL(url);
    } catch (e) {
        return res.view("error.njk", {
            error: "Invalid URL: '"+url+"'"
        });
    }

    const domain = parsed_url.hostname;

    if (!VALID_URLS.includes(domain)) {
        return res.view("error.njk", {
            error: "Not a known Bluesky host '"+domain+"'"
        });
    }

    const show_thread = (req.query.show_thread == "on") || (req.query.show_thread == "t"); //support legacy value of 't' for existing URLs
    const hide_parent = req.query.hide_parent == "on";

    const handle = parsed_url.pathname.split("/")[2];
    const post_id = parsed_url.pathname.split("/")[4];

    if (!handle || !post_id) {
        return res.view("error.njk", {
            error: "Empty handle '"+handle+"' or post '"+post_id+"'"
        });
    }
    let query_parts = [];
    if (show_thread){
        query_parts.push("show_thread=on");
    }
    if (hide_parent){
        query_parts.push("hide_parent=on");
    }
    query_parts.push("url="+url);
    const query_string = "?" + query_parts.join("&");
    if (cache.has(query_string)) {
        const data = cache.get(query_string);
        return res.view("post.njk", data);
    }
    // app.log.info("resolveHandle fetch: token='"+token+"'; refresh='"+refresh+"';");
    const resolveHandle = await fetch("https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=" + handle, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token
        }
    });
    app.log.info("resolveHandle fetch: status='"+resolveHandle.status+"'; statusText='"+resolveHandle.statusText+"';");
    if (resolveHandle.status !=200){
        auth_token_expires = new Date().getTime();
        return res.view("error.njk", {
            error: "Connection problem, try reloading"
        });
    }
    const { did } = await resolveHandle.json();
    const getPostThread = await fetch(`https://bsky.social/xrpc/app.bsky.feed.getPostThread?uri=at://${did}/app.bsky.feed.post/${post_id}`, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token
        },
    });
    app.log.info("getPostThread fetch: status='"+getPostThread.status+"'; statusText='"+getPostThread.statusText+"';");
    if (getPostThread.status !=200){
        auth_token_expires = new Date().getTime();
        return res.view("error.njk", {
            error: "Connection problem, try reloading"
        });
    }
    const data = await getPostThread.json();
    if (data && data.thread && data.thread.post) {
        // eschew preprocessing
    } else {
        return res.view("error.njk", {
            error: "No thread or post"
        });
    }

    const author_handle = data.thread.post?.author?.handle;

    const flat_replies = flattenReplies(data.thread.replies, author_handle);

    const response_data = {
        thread: data.thread,
        url: "https://"+domain+"/" + query_string,
        post_url: url,
        show_thread: show_thread,
        hide_parent: hide_parent,
        flat_replies: flat_replies,
    };

    cache.set(query_string, response_data);

    return res.view("post.njk", response_data);
});
app.get("/feed", async (req, res) => {
    if (new Date().getTime() > auth_token_expires) {
        await refreshAuthToken();
    }

    const user = req.query.user?req.query.user.toLowerCase():'';

    if (!user) {
        return res.redirect('/#emcode');
    }
    // app.log.info("getAuthorFeed fetch: token='"+token+"'; refresh='"+refresh+"';");
    const response = await fetch("https://bsky.social/xrpc/app.bsky.feed.getAuthorFeed?actor=" + user, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token
        }
    });
    app.log.info("getAuthorFeed fetch: status='"+response.status+"'; statusText='"+response.statusText+"';");
    if (response.status !=200){
        auth_token_expires = new Date().getTime();
        return res.view("error.njk", {
            error: "Connection problem, try reloading"
        });
    }
    const { feed } = await response.json();
    return res.view("feed.njk", {
        author: user,
        posts: feed,
    });
});
app.get("/getfeed", async (req, res) => {
    if (new Date().getTime() > auth_token_expires) {
        await refreshAuthToken();
    }

    var handle = req.query.handle;

    if (!handle) {
        return res.status(400).send("No handle provided");
    }

    if (handle.startsWith("https://staging.bsky.app/profile/")) {
        handle = handle.replace("https://staging.bsky.app/profile/", "");
    } else if (handle.startsWith("https://bsky.app/profile/")) {
        handle = handle.replace("https://bsky.app/profile/", "");
    }

    handle = handle.replace("/", "");

    if (handle.startsWith("did:")) {
        const response = await fetch("https://bsky.social/xrpc/app.bsky.actor.getProfile?actor=" + handle, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token
            }
        });
        ({ handle } = await response.json());
        return res.send({
            handle
        });
    } else {
        return res.send({
            handle
        });
    }
});
// run in production mode
app.listen({ port: PORT }, (err) => {
    if (err) {
        app.log.error(err)
        process.exit(1)
    }
});