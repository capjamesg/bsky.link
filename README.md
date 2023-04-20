# Bluesky Link Preview

Generate permalinks to Bluesky posts that you can embed in other sites.

## Screenshot

![Screenshot of a Bluesky post written by jamesg.blog](screenshot.png)

## How to Embed

To embed a link preview, simply add the following to your post:

```
<iframe src="https://bsky.link/?url=https://staging.bsky.app/profile/jamesg.blog/post/3jt27gpzmut2a/"></iframe>
```

## How to Run

To run, first install the required dependencies:

```
npm install
```

Then, open `config.js` and add your Bluesky handle and password.

Finally, run the following command to start the application server:

```
npm start
```

## License

This project is licensed under an [MIT 0 License](LICENSE).

## Contributors

- capjamesg