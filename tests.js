const { mf2 } = require("microformats-parser");

const ROOT_URL = "http://localhost:3008/?url=";

var urls = [
    "https://staging.bsky.app/profile/pfrazee.com/post/3juxla7zr762b",
    "https://bsky.app/profile/dholms.xyz/post/3juyy5bpik52h",
    "https://bsky.app/profile/nowah.bsky.social/post/3juti6hxske24",
    "https://bsky.app/profile/tudorgirba.com/post/3jutyyruobi22"
];

Promise.allSettled(urls.map(function (url) {
    var url = ROOT_URL + url;
    return fetch(url, {
        method: "GET",
    }).then((response) => {
        var url = response.url;
        return response.text().then((data) => {
            var mf2Data = mf2(data, {baseUrl: url});
            if (mf2Data.items.length == 0) {
                throw Error("No mf2 data found for " + url);
            }
            return mf2Data;
        });
    });
})).then(function (testResults) {
    if (testResults.every(function (promise) {
        return promise.status === "fulfilled";
    })) {
        console.log("All tests passed!");
    } else {
        console.log("Some tests failed.");
    }
});