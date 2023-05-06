const express = require("express");
const ejs = require("ejs");
const { LRUCache } = require("lru-cache");

var config = require("./config.js");

var XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const PORT = process.env.PORT || 3008;
const VALID_URLS = ["bsky.app", "staging.bsky.app"];

const app = express();

app.set("view engine", "ejs");
app.use(express.static("public"));
app.use((err, req, res, next) => {
    res.status(500).render("error", {
        error: "There was an error loading this page."
    });
});

var xhr = new XMLHttpRequest();

xhr.open("POST", "https://bsky.social/xrpc/com.atproto.server.createSession", true);
xhr.setRequestHeader("Content-Type", "application/json");
xhr.send(JSON.stringify({
    identifier: config.HANDLE,
    password: config.PASSWORD
}));

var token = "";

xhr.onreadystatechange = function () {
    if (this.readyState == 4) {
        token = JSON.parse(this.responseText).accessJwt;
    }
}

function flattenReplies (replies, author_handle, iteration = 0) {
    // replies are nested objects of .replies, so we need to flatten them
    var all_replies = [];

    if (iteration > 20) {
        return all_replies;
    }

    if (!replies || replies.length == 0) {
        return all_replies;
    }

    for (var i = 0; i < replies.length; i++) {
        var reply = replies[i];

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
    var url = req.query.url;

    if (!url) {
        // load home.ejs
        res.render("home");
        return;
    }

    try {
        var parsed_url = new URL(url);
    } catch (e) {
        res.render("error", {
            error: "Invalid URL"
        });
        return;
    }

    var domain = parsed_url.hostname;

    if (!VALID_URLS.includes(domain)) {
        res.render("error", {
            error: "Invalid URL"
        });
        return;
    }

    var show_thread = req.query.show_thread == "t";
    var hide_parent = req.query.hide_parent == "t";

    var handle = parsed_url.pathname.split("/")[2];
    var post_id = parsed_url.pathname.split("/")[4];

    if (!handle || !post_id) {
        res.render("error", {
            error: "Invalid URL"
        });
        return;
    }

    if (cache.has(url)) {
        var data = cache.get(url);
        res.render("post", data);
        return;
    }

    fetch("https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=" + handle, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token
        }
    }).then((response) => {
        response.json().then((did) => {
            fetch(`https://bsky.social/xrpc/app.bsky.feed.getPostThread?uri=at://${did.did}/app.bsky.feed.post/${post_id}`, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + token
                },
            }).then((response) => {
                response.json().then((data) => {
                    var embed = null;
                    var embed_type = null;

                    if (data && data.thread && data.thread.post) {
                        if (data.thread.post.embed && data.thread.post.embed.record) {
                            var embed = data.thread.post.embed.record;
                            var embed_type = "record";
                        } else if (data.thread.post.embed && data.thread.post.embed.images) {
                            var embed = data.thread.post.embed.images;
                            var embed_type = "images";
                        }
                    } else {
                        res.render("error", {
                            error: "Invalid URL"
                        });
                        return;
                    }

                    var createdAt = new Date(data.thread.post.record.createdAt);

                    var readableDate = createdAt.toLocaleString("en-US", {
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                        hour: "numeric",
                        minute: "numeric",
                        second: "numeric",
                        hour12: true,
                    }).replace(",", "");

                    var author_handle = data.thread.post.author.handle;

                    var all_replies = flattenReplies(data.thread.replies, author_handle);

                    var parent;

                    if (hide_parent) {
                        parent = [];
                    } else {
                        parent = data.thread.parent ? data.thread.parent : null;
                    }

                    var response_data = {
                        data: data.thread.post.record,
                        author: data.thread.post.author,
                        embed: embed,
                        embed_type: embed_type,
                        url: "https://bsky.link/?url=" + url,
                        post_url: url,
                        reply_count: data.thread.post.replyCount,
                        like_count: data.thread.post.likeCount,
                        repost_count: data.thread.post.repostCount,
                        created_at: readableDate,
                        replies: show_thread ? all_replies : [],
                        parent: parent
                    };

                    cache.set(url, response_data);

                    res.render("post", response_data);
                });
            });
        });
    });
});

app.route("/feed").get(async (req, res) => {
    var user = req.query.user;

    if (!user) {
        res.render("error", {
            error: "Invalid user"
        });
        return;
    }

    fetch("https://bsky.social/xrpc/app.bsky.feed.getAuthorFeed?actor=" + user, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token
        }
    }).then((response) => {
        response.json().then((data) => {
            var posts = data.feed;

            // if no posts, error out
            if (!posts || posts.length == 0) {
                res.render("error", {
                    error: "No posts found"
                });
                return;
            }

            for (var i = 0; i < posts.length; i++) {
                var post = posts[i].post;

                if (post.embed && post.embed.record) {
                    var embed = post.embed.record;
                    var embed_type = "record";
                } else if (post.embed && post.embed.images) {
                    var embed = post.embed.images;
                    var embed_type = "images";
                } else {
                    var embed = [];
                    var embed_type = null;
                }

                post.embed = embed;
                post.embed_type = embed_type;

                var createdAt = new Date(post.record.createdAt);

                var readableDate = createdAt.toLocaleString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                    hour: "numeric",
                    minute: "numeric",
                    second: "numeric",
                    hour12: true,
                }).replace(",", "");

                post.record.createdAt = readableDate;
            }
            
            res.render("feed", {
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