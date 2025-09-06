/**
 * This is an example of a basic node.js script that performs
 * the Authorization Code oAuth2 flow to authenticate against
 * the Spotify Accounts.
 *
 * For more information, read
 * https://developer.spotify.com/documentation/web-api/tutorials/code-flow
 */

var express = require("express");
var request = require("request");
var crypto = require("crypto");
var cors = require("cors");
var querystring = require("querystring");
var cookieParser = require("cookie-parser");
require("dotenv").config();

const client_id = process.env.CLIENT_ID;
const client_secret = process.env.CLIENT_SECRET;
const redirect_uri =
  process.env.REDIRECT_URI || "http://127.0.0.1:8888/callback";

const generateRandomString = (length) => {
  return crypto.randomBytes(60).toString("hex").slice(0, length);
};

var stateKey = "spotify_auth_state";

var app = express();

app
  .use(express.static(__dirname + "/public"))
  .use(cors())
  .use(cookieParser());

app.get("/login", function (req, res) {
  var state = generateRandomString(16);
  res.cookie(stateKey, state);

  // your application requests authorization
  var scope =
    "user-read-private user-read-email playlist-read-private playlist-modify-private playlist-modify-public user-follow-modify user-follow-read user-read-playback-position user-read-recently-played user-top-read streaming app-remote-control user-read-playback-state user-modify-playback-state user-read-currently-playing";
  res.redirect(
    "https://accounts.spotify.com/authorize?" +
      querystring.stringify({
        response_type: "code",
        client_id: client_id,
        scope: scope,
        redirect_uri: redirect_uri,
        state: state,
      })
  );
});

app.get("/callback", function (req, res) {
  // your application requests refresh and access tokens
  // after checking the state parameter

  var code = req.query.code || null;
  var state = req.query.state || null;
  var storedState = req.cookies ? req.cookies[stateKey] : null;

  // Debugging logs
  console.log("authorization_code", code);

  if (state === null || state !== storedState) {
    res.redirect(
      "/#" +
        querystring.stringify({
          error: "state_mismatch",
        })
    );
  } else {
    res.clearCookie(stateKey);
    var authOptions = {
      url: "https://accounts.spotify.com/api/token",
      form: {
        code: code,
        redirect_uri: redirect_uri,
        grant_type: "authorization_code",
      },
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " +
          new Buffer.from(client_id + ":" + client_secret).toString("base64"),
      },
      json: true,
    };

    request.post(authOptions, function (error, response, body) {
      if (!error && response.statusCode === 200) {
        var access_token = body.access_token,
          refresh_token = body.refresh_token;

        var options = {
          url: "https://api.spotify.com/v1/me",
          headers: { Authorization: "Bearer " + access_token },
          json: true,
        };

        console.log("access_token:", access_token);
        console.log("refresh_token:", refresh_token);

        // use the access token to access the Spotify Web API
        request.get(options, function (error, response, body) {
          console.log(body);
        });

        // we can also pass the token to the browser to make requests from there
        res.redirect(
          "/#" +
            querystring.stringify({
              access_token: access_token,
              refresh_token: refresh_token,
            })
        );
      } else {
        res.redirect(
          "/#" +
            querystring.stringify({
              error: "invalid_token",
            })
        );
      }
    });
  }
});

app.get("/refresh_token", function (req, res) {
  var refresh_token = req.query.refresh_token;
  var authOptions = {
    url: "https://accounts.spotify.com/api/token",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " +
        new Buffer.from(client_id + ":" + client_secret).toString("base64"),
    },
    form: {
      grant_type: "refresh_token",
      refresh_token: refresh_token,
    },
    json: true,
  };

  request.post(authOptions, function (error, response, body) {
    if (!error && response.statusCode === 200) {
      var access_token = body.access_token,
        refresh_token = body.refresh_token;
      res.send({
        access_token: access_token,
        refresh_token: refresh_token,
      });
    }
  });
});

app.post("/recommendations", express.json(), async function (req, res) {
  try {
    const selectedArtists = req.body.artists; // array of {id, name} from frontend
    const accessToken = req.headers.authorization?.split(" ")[1];

    if (!accessToken) {
      return res.status(401).json({ error: "Missing access token" });
    }
    if (!selectedArtists || selectedArtists.length === 0) {
      return res.status(400).json({ error: "No selected artists provided" });
    }

    // Helper to call Spotify API
    const fetchSpotify = (url) =>
      new Promise((resolve, reject) => {
        request.get(
          {
            url,
            headers: { Authorization: "Bearer " + accessToken },
            json: true,
          },
          (err, response, body) => {
            if (err) reject(err);
            else if (response.statusCode !== 200) reject(body);
            else resolve(body);
          }
        );
      });

    // 1. Get user's top artists (limit 50)
    const topArtistsData = await fetchSpotify(
      "https://api.spotify.com/v1/me/top/artists?limit=50"
    );
    const topArtists = topArtistsData.items.map((a) => ({
      id: a.id,
      name: a.name,
    }));

    // 2. Get user's top tracks (limit 50)
    const topTracksData = await fetchSpotify(
      "https://api.spotify.com/v1/me/top/tracks?limit=50"
    );
    const topTrackArtists = [];
    topTracksData.items.forEach((track) => {
      track.artists.forEach((a) => {
        topTrackArtists.push({ id: a.id, name: a.name });
      });
    });

    // 3. Merge into a sorted unique list
    const merged = [];
    const seen = new Set();

    // first push top artists
    topArtists.forEach((a) => {
      if (!seen.has(a.id)) {
        merged.push(a);
        seen.add(a.id);
      }
    });

    // then push from top track artists
    topTrackArtists.forEach((a) => {
      if (!seen.has(a.id)) {
        merged.push(a);
        seen.add(a.id);
      }
    });

    // 4. Match with selectedArtists
    const selectedIds = new Set(selectedArtists.map((a) => a.id));
    const matches = merged.filter((a) => selectedIds.has(a.id));

    // 5. Return just the names in sorted order
    res.json(matches.map((a) => a.name));
  } catch (err) {
    console.error("Error in /recommendations:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

console.log("Listening on 8888");
app.listen(8888);
