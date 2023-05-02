const express = require("express");
const ejs = require("ejs");

var config = require("./config.js");

var XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const PORT = process.env.PORT || 3008;

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

//     if (!url.match(/https:\/\/staging.bsky.app\/profile\/[a-z0-9]+\.bsky\.social\/post\/[a-z0-9]+/)) {
//         // send 400
//         res.status(400).send("Invalid URL.");
//         return;
//     }

    var handle = new URL(url).pathname.split("/")[2];
    var post_id = new URL(url).pathname.split("/")[4];

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
                    if (data.thread.post.embed && data.thread.post.embed.record) {
                        var embed = data.thread.post.embed.record;
                        var embed_type = "record";
                    } else if (data.thread.post.embed && data.thread.post.embed.images) {
                        var embed = data.thread.post.embed.images;
                        var embed_type = "images";
                    } else {
                        var embed = null;
                        var embed_type = null;
                    }
                    res.render("post", {
                        data: data.thread.post.record,
                        author: data.thread.post.author,
                        embed: embed,
                        embed_type: embed_type,
                        url: "https://bsky.link/?url=" + url
                    });
                });
            });
        });
    });
});

app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});
