import socket

from flask import Flask

app = Flask(__name__)


@app.route("/")
def hello():
    return f"""
    <h1>Hello World from Python + Flask</h1>
    <p>DevOps Heros &mdash; Session 6-7 Docker task</p>
    <p>container hostname: <code>{socket.gethostname()}</code></p>
    """


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
