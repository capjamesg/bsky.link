"use strict";
const express = require("express");
const { LRUCache } = require("lru-cache");
const nunjucks = require('nunjucks');
const dateFilter = require('nunjucks-date-filter');

const config = require("./config.js");

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const PORT = process.env.PORT || 3008;
const VALID_URLS = ["bsky.app", "staging.bsky.app"];

const debug_log = false;

function log(s) {
    if(debug_log){
        console.log(s)
    }
}

const app = express();

app.use(express.static("public"));
app.use((err, req, res, next) => {
    res.status(500).render("error.njk", {
        error: "There was an error loading this page."
    });
});
const nun_env = nunjucks.configure('views', { 
    autoescape: true, 
    'express': app 
});
nun_env.addFilter('date', dateFilter);
nun_env.addFilter('last_path', function(str) {
    return str.split('/').pop();
});

let token = "";
let auth_token_expires = new Date().getTime();
let refresh = "";
getAuthToken();

function getAuthToken () {
    log("getAuthToken called ");
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
        log("getAuthToken status:'"+response.status+"' statustText:'"+response.statusText+"';")
        return response.json().then((data) => {
            //log(data);
            if (response.status==200) {
                token = data.accessJwt;
                refresh = data.refreshJwt;
                log("getAuthToken response: token='"+token+"'; refresh='"+refresh+"';")
                auth_token_expires = new Date().getTime() + 1000 *5 * 60 * 30;
            }
        })
    })
    .catch(err =>{
        //catch err 
        console.log(err);
    });                       
}

function refreshAuthToken () {
    log("refreshAuthToken called with: token='"+token+"'; refresh='"+refresh+"';");
    return fetch("https://bsky.social/xrpc/com.atproto.server.refreshSession", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + refresh
        }
    })
    .then (response => {
        log("refreshAuthToken status:'"+response.status+"' statustText:'"+response.statusText+"';")
        return response.json().then((data) => {
            //log(data);
            if (response.status==200) {
                token = data.accessJwt;
                refresh = data.refreshJwt;
                auth_token_expires = new Date().getTime() + 1000 *5 * 60 * 30;
                log("refreshAuthToken response: token='"+token+"'; refresh='"+refresh+"';")
            }
        })
    })
    .catch(err =>{
        //catch err 
        console.log(err);
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
        if (reply.post.author.handle != author_handle) {
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

app.route("/").get(async (req, res) => {
    if (new Date().getTime() > auth_token_expires) {
        await refreshAuthToken();
    }

    const url = req.query.url;
    let parsed_url;

    if (!url) {
        // show home
        res.render("home.njk");
        return;
    }

    try {
        parsed_url = new URL(url);
    } catch (e) {
        res.render("error.njk", {
            error: "Invalid URL: '"+url+"'"
        });
        return;
    }

    const domain = parsed_url.hostname;

    if (!VALID_URLS.includes(domain)) {
        res.render("error.njk", {
            error: "Not a known Bluesky host '"+domain+"'"
        });
        return;
    }

    const show_thread = (req.query.show_thread == "on") || (req.query.show_thread == "t"); //support legacy value of 't' for existing URLs
    const hide_parent = req.query.hide_parent == "on";

    const handle = parsed_url.pathname.split("/")[2];
    const post_id = parsed_url.pathname.split("/")[4];

    if (!handle || !post_id) {
        res.render("error.njk", {
            error: "Empty handle '"+handle+"' or post '"+post_id+"'"
        });
        return;
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
        res.render("post.njk", data);
        return;
    }
    log("resolveHandle fetch: token='"+token+"'; refresh='"+refresh+"';");
    return fetch("https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=" + handle, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token
        }
    }).then((response) => {
        response.json().then((did) => {
            log("getPostThread fetch: token='"+token+"'; refresh='"+refresh+"';");
            fetch(`https://bsky.social/xrpc/app.bsky.feed.getPostThread?uri=at://${did.did}/app.bsky.feed.post/${post_id}`, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + token
                },
            }).then((response) => {
                response.json().then((data) => {

                    if (data && data.thread && data.thread.post) {
                        // eschew preprocessing
                    } else {
                        res.render("error.njk", {
                            error: "No thread or post"
                        });
                        return;
                    }

                    const author_handle = data.thread.post.author.handle;

                    const flat_replies = flattenReplies(data.thread.replies, author_handle);

                    const response_data = {
                        thread: data.thread,
                        url: "https://bsky.link/" + query_string,
                        post_url: url,
                        show_thread: show_thread,
                        hide_parent: hide_parent,
                        flat_replies: flat_replies,
                    };

                    cache.set(query_string, response_data);

                    res.render("post.njk", response_data);
                });
            });
        });
    });
});
app.route("/feed").get(async (req, res) => {
    if (new Date().getTime() > auth_token_expires) {
        await refreshAuthToken();
    }

    const user = req.query.user;

    if (!user) {
        res.render("error.njk", {
            error: "You need to use a url like bsky.link/feed?user=jay.bsky.team"
        });
        return;
    }
    log("getAuthorFeed fetch: token='"+token+"'; refresh='"+refresh+"';");
    return fetch("https://bsky.social/xrpc/app.bsky.feed.getAuthorFeed?actor=" + user, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token
        }
    }).then((response) => {
        response.json().then((data) => {
            const posts = data.feed;

            res.render("feed.njk", {
                author: user,
                posts: data.feed,
                url: "https://bsky.link/feed?user=" + user,
                post_url: "https://staging.bsky.social/profile/" + user
            });
        });
    });
});

// run in production mode
app.listen(PORT, () => {
    console.log("Server started on port " + PORT);
});