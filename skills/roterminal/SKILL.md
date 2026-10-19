---
name: roterminal
description: Live data on every Roblox game from RoTerminal. Players right now, each game's day-by-day history since Sep 27 2026, rising and new games, what developers are making (trends), genres, Roblox's charts, studios and who's behind a game, and the person's own games. Use it for any question about Roblox games' players, popularity, growth, competitors, what to build next, or how an update did, before and after shipping a Roblox update, and when deciding what game to make.
---

# RoTerminal

Run RoTerminal's command line. It answers in JSON when you run it: `{ status, data, link, next }`.

```
npx -y roterminal <command> --json
```

## Commands

- `npx roterminal game "grow a garden"`: A game now. Everything on one Roblox game right now: players now and its place on Roblox, the change over 1 and 24 hours, highs (24 hours, 14 days, since tracking began on Sep 27 2026), momentum and 7-day average, its genre and its place in it, its developer and the people behind it, its latest updates with how players moved after each, its closest rivals, its places on Roblox’s charts, and a 7-day line of its players (spark_7d).
- `npx roterminal days "grow a garden" --days 14`: Day by day. One game’s players day by day (New York days, newest first): the average, peak and low, visits that day, and what happened (updates, events).
- `npx roterminal search "dandys world"`: Find a game. Find Roblox games by name: up to 8 matches with their universe id, developer, genre and players now, the most played first.
- `npx roterminal rising --week --genre tycoon`: Rising. The Roblox games gaining players fastest, against a day ago (range 24h) or a week ago (range 7d), each with its players now and then, the change, genre, when it came out and a line of its players.
- `npx roterminal top --genre simulation`: Most played. A ranked list of Roblox games now.
- `npx roterminal trends brainrot`: Trends. What developers are making games about: the words in new games’ names, by how many new games used them in the last 30 days against the 30 before, with the biggest game for each.
- `npx roterminal compare "grow a garden" "steal a brainrot"`: Compare. Two to five Roblox games side by side now: players, change over 24 hours, momentum, genre place, latest update and its result, and a 7-day line of each one’s players.
- `npx roterminal studio "grow a garden"`: Who’s behind it. A developer (a Roblox group or one person) and the games they make, by one of their games or by name: who owns it, members, verified, their place among developers, players in all their games now, and each game with players now, visits and likes.
- `npx roterminal screen --theme horror --max-age 30 --sort change_7d`: Screener. Screen the 600 most played Roblox games by their numbers: genre, a theme they’re about (a word in their names and descriptions, like horror, anime or tycoon), players now, change over 24 hours or 7 days, age and likes, sorted by what you pick.
- `npx roterminal roblox`: All of Roblox. Players online across all of Roblox right now, the change on a day ago and on a week ago.
- `npx roterminal genres`: Genres. Every genre on Roblox now: players, its share of everyone playing, the change on a day ago, how many games, its subgenres and its biggest games.
- `npx roterminal charts top-earning`: Roblox’s charts. Roblox’s own charts (Top Earning, Top Trending, Up-and-Coming and the rest), as RoTerminal keeps them day by day: with no chart, the list of charts; with a chart id, its top games now.
- `npx roterminal watch "grow a garden"`: Live. One game’s players this second, its place on Roblox and its 24-hour high.
- `npx roterminal me`: Your games. The signed-in person’s own games (the ones My Games shows them): players now against usual for this time, the latest update and how players moved after it, and today’s alerts.

Games can be named by name or universe id.

## When to use it

- Before deciding what to build: `trends`, `rising --week`, `screen --theme <word>`. Check whether an idea has been done with `trends <word>` and `search`.
- Before and after an update to the person's game: `me` and `game <their game>`. After, `days <their game>` shows how players moved.
- Sizing up rivals: `game`, then `compare` with the rivals it lists.
- Pair it with Roblox Studio's MCP server when changing the game itself.

## Rules

- Cite `link` when you use the numbers.
- On `status: action_required`, show the person `message` and `verification_uri`, wait for them, then run the same command again.
- `next` suggests what to run next.
- Without an account an address gets 50 calls a day. `npx -y roterminal login` (free) gives 200.
