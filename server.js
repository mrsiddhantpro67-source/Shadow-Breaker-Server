const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 10000;

app.use(express.static("public"));

app.get("/health", (req, res) => {
    res.json({
        online: true,
        players: Object.keys(players).length
    });
});

const players = {};

const WORLD_WIDTH = 5200;
const WORLD_HEIGHT = 700;

const MAX_PLAYERS = 20;

function randomSpawn() {
    return {
        x: 120 + Math.random() * 250,
        y: 500
    };
}

function createPlayer(ws) {

    const id = crypto.randomUUID();

    const spawn = randomSpawn();

    players[id] = {
        id,

        x: spawn.x,
        y: spawn.y,

        vx: 0,
        vy: 0,

        w: 38,
        h: 65,

        health: 100,

        facing: 1,

        grounded: false,

        attack: false,
        dash: false,
        burst: false,

        frame: 0,

        score: 0,

        name: "Ninja-" + id.slice(0, 4),

        ws
    };

    return players[id];
}

function publicPlayer(p) {

    return {
        id: p.id,

        x: p.x,
        y: p.y,

        vx: p.vx,
        vy: p.vy,

        health: p.health,

        facing: p.facing,

        grounded: p.grounded,

        attack: p.attack,

        dash: p.dash,

        burst: p.burst,

        frame: p.frame,

        score: p.score,

        name: p.name
    };
}

function broadcast(data) {

    const message = JSON.stringify(data);

    for (const id in players) {

        const p = players[id];

        if (p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(message);
        }
    }
}

wss.on("connection", ws => {

    if (Object.keys(players).length >= MAX_PLAYERS) {

        ws.send(JSON.stringify({
            type: "error",
            message: "Server is full."
        }));

        ws.close();

        return;
    }

    const player = createPlayer(ws);

    ws.send(JSON.stringify({
        type: "welcome",
        id: player.id,
        player: publicPlayer(player)
    }));

    broadcast({
        type: "players",
        players: Object.values(players).map(publicPlayer)
    });

    ws.on("message", raw => {

        let data;

        try {
            data = JSON.parse(raw);
        }
        catch {
            return;
        }

        const p = players[player.id];

        if (!p) return;

        // ------------------------------------
        // INPUT
        // ------------------------------------

        if (data.type === "input") {

            const input = data.input || {};

            p.vx = 0;

            if (input.left) {
                p.vx = -4.5;
                p.facing = -1;
            }

            if (input.right) {
                p.vx = 4.5;
                p.facing = 1;
            }

            if (input.jump && p.grounded) {

                p.vy = -12;
                p.grounded = false;
            }

            if (input.attack) {
                p.attack = true;
            }

            if (input.dash) {

                p.vx = p.facing * 14;
                p.dash = true;
            }

            if (input.burst) {
                p.burst = true;
            }
        }

        // ------------------------------------
        // PLAYER NAME
        // ------------------------------------

        if (data.type === "name") {

            if (
                typeof data.name === "string" &&
                data.name.length > 0 &&
                data.name.length <= 16
            ) {

                p.name = data.name.replace(
                    /[^a-zA-Z0-9 _-]/g,
                    ""
                );
            }
        }
    });

    ws.on("close", () => {

        delete players[player.id];

        broadcast({
            type: "playerLeft",
            id: player.id
        });

        broadcast({
            type: "players",
            players: Object.values(players).map(publicPlayer)
        });
    });
});


// =====================================================
// SERVER GAME LOOP
// =====================================================

const gravity = 0.55;

const platforms = [

    { x: 0, y: 630, w: 5200, h: 70 },

    { x: 600, y: 530, w: 250, h: 30 },

    { x: 1050, y: 450, w: 260, h: 30 },

    { x: 1500, y: 530, w: 280, h: 30 },

    { x: 1950, y: 410, w: 300, h: 30 },

    { x: 2450, y: 500, w: 300, h: 30 },

    { x: 2900, y: 400, w: 300, h: 30 },

    { x: 3400, y: 480, w: 300, h: 30 },

    { x: 3900, y: 360, w: 320, h: 30 },

    { x: 4400, y: 480, w: 400, h: 30 }
];

function intersects(a, b) {

    return (
        a.x < b.x + b.w &&
        a.x + a.w > b.x &&
        a.y < b.y + b.h &&
        a.y + a.h > b.y
    );
}

function updatePlayer(p) {

    p.x += p.vx;

    p.vy += gravity;

    p.y += p.vy;

    p.grounded = false;

    for (const platform of platforms) {

        if (
            p.x < platform.x + platform.w &&
            p.x + p.w > platform.x &&
            p.y + p.h >= platform.y &&
            p.y + p.h <= platform.y + 25 &&
            p.vy >= 0
        ) {

            p.y = platform.y - p.h;

            p.vy = 0;

            p.grounded = true;
        }
    }

    // World bounds

    if (p.x < 0) {
        p.x = 0;
    }

    if (p.x > WORLD_WIDTH - p.w) {
        p.x = WORLD_WIDTH - p.w;
    }

    // Fall recovery

    if (p.y > WORLD_HEIGHT + 150) {

        p.x = 120;
        p.y = 500;

        p.vx = 0;
        p.vy = 0;

        p.health = 100;
    }

    if (Math.abs(p.vx) > 0.2) {
        p.frame += 0.3;
    }
    else {
        p.frame = 0;
    }

    // Attack lasts one server tick

    if (p.attack) {

        for (const id in players) {

            const target = players[id];

            if (target.id === p.id)
                continue;

            const attackBox = {

                x: p.facing === 1
                    ? p.x + p.w
                    : p.x - 60,

                y: p.y + 5,

                w: 60,
                h: 55
            };

            if (intersects(attackBox, target)) {

                target.health -= 10;

                target.vx = p.facing * 7;
                target.vy = -5;

                if (target.health <= 0) {

                    target.health = 100;

                    target.x = 120;
                    target.y = 500;

                    p.score++;
                }
            }
        }
    }

    p.attack = false;
    p.dash = false;
    p.burst = false;
}

setInterval(() => {

    for (const id in players) {
        updatePlayer(players[id]);
    }

    broadcast({
        type: "state",
        players: Object.values(players).map(publicPlayer)
    });

}, 1000 / 30);


// =====================================================
// START SERVER
// =====================================================

server.listen(PORT, () => {

    console.log(
        `Shadow Ninja server running on port ${PORT}`
    );

});
