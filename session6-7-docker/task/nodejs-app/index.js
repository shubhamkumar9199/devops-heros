const express = require('express');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.type('html').send(`
    <h1>Hello World from Node.js + Express</h1>
    <p>DevOps Heros &mdash; Session 6-7 Docker task</p>
    <p>container hostname: <code>${os.hostname()}</code></p>
  `);
});

app.listen(PORT, '0.0.0.0', () => console.log(`node app listening on ${PORT}`));
