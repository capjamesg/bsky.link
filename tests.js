const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { mf2 } = require("microformats-parser");

const ROOT_URL = "http://localhost:3008/?url=";

var urls = [
    "https://staging.bsky.app/profile/pfrazee.com/post/3juxla7zr762b",
    "https://bsky.app/profile/dholms.xyz/post/3juyy5bpik52h",
    "https://bsky.app/profile/nowah.bsky.social/post/3juti6hxske24",
    "https://bsky.app/profile/tudorgirba.com/post/3jutyyruobi22"
];

for (var i = 0; i < urls.length; i++) {
    var url = ROOT_URL + urls[i];
    fetch(url, {
        method: "GET",
    }).then((response) => {
        var url = response.url;
        response.text().then((data) => {
            var mf2Data = mf2(data, {baseUrl: url});
            if (mf2Data.items.length == 0) {
                throw Error("No mf2 data found for " + url);
            }
        });
    });
}

console.log("All tests passed!");