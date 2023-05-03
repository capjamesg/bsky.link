const express = require("express");
const ejs = require("ejs");

var config = require("./config.js");

var XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const PORT = process.env.PORT || 3008;
const VALID_URLS = ["bsky.app", "staging.bsky.app"];

const app = express();

app.set("view engine", "ejs");
app.use(express.static("public"));

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

app.route("/").get(async (req, res) => {
    var url = req.query.url;

    if (!url) {
        // load home.ejs
        res.render("home");
        return;
    }

    var parsed_url = new URL(url);

    var domain = parsed_url.hostname;

    if (!VALID_URLS.includes(domain)) {
        res.render("error", {
            error: "Invalid URL"
        });
        return;
    }

    var handle = parsed_url.pathname.split("/")[2];
    var post_id = parsed_url.pathname.split("/")[4];

    fetch("https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=" + handle, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token
        }
    }).then((response) => {
        response.json().then((did) => {
            fetch(`https://bsky.social/xrpc/app.bsky.feed.getPostThread?uri=at://${did.did}/app.bsky.feed.post/${post_id}&depth=0`, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer " + token
                },
            }).then((response) => {
                response.json().then((data) => {
                    var embed = null;
                    var embed_type = null;

                    if (data && data.thread && data.thread.post)
                        if (data.thread.post.embed && data.thread.post.embed.record) {
                            var embed = data.thread.post.embed.record;
                            var embed_type = "record";
                        } else if (data.thread.post.embed && data.thread.post.embed.images) {
                            var embed = data.thread.post.embed.images;
                            var embed_type = "images";
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

                    res.render("post", {
                        data: data.thread.post.record,
                        author: data.thread.post.author,
                        embed: embed,
                        embed_type: embed_type,
                        url: "https://bsky.link/?url=" + url,
                        post_url: url,
                        reply_count: data.thread.post.replyCount,
                        like_count: data.thread.post.likeCount,
                        repost_count: data.thread.post.repostCount,
                        created_at: readableDate
                    });
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
            // if reason, print to console
            for (var i = 0; i < data.feed.length; i++) {
                if (data.feed[i].reason) {
                    console.log(data.feed[i].reason);
                }
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

app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});
