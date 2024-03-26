import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { NodeState, Value } from "../types";
import { delay } from "../utils";
import * as http from 'http';


export async function node(
  nodeId: number,
  N: number,
  F: number,
  initialValue: Value,
  isFaulty: boolean,
  nodesAreReady: () => boolean,
  setNodeIsReady: (index: number) => void
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  let currentNodeState: NodeState = {
    killed: false,
    x: null,
    decided: null,
    k: null,
  }
  let proposals: Map<number, Value[]> = new Map();
  let votes: Map<number, Value[]> = new Map();

  // Endpoint pour vérifier le statut du nœud
node.get("/status", (req, res) => {
  const status = isFaulty ? 500 : 200;
  const message = isFaulty ? "faulty" : "live";
  res.status(status).send(message);
});

// Endpoint pour arrêter le nœud
node.get("/stop", (req, res) => {
  currentNodeState.killed = true;
  res.send({ status: "killed" }); // Envoyer une réponse JSON au lieu d'une chaîne de caractères simple
});

// Endpoint pour obtenir l'état actuel du nœud
node.get("/getState", (req, res) => {
  res.json(currentNodeState); // Utiliser res.json pour une réponse explicite en JSON
});


  // Endpoint to start the consensus algorithm
  node.get("/start", async (req, res) => {
    while (!nodesAreReady()) {
      await delay(5);
    }

    if (!isFaulty) {
      currentNodeState = { k: 1, x: initialValue, decided: false, killed: currentNodeState.killed };
      for (let i = 0; i < N; i++) {
        sendMessage(`http://localhost:${BASE_NODE_PORT + i}/message`, { k: currentNodeState.k, x: currentNodeState.x, messageType: "propose" });
      }
    } else {
      currentNodeState = { k: null, x: null, decided: null, killed: currentNodeState.killed };
    }

    res.status(200).send("Consensus algorithm started.");
  });

  // Endpoint to receive messages from other nodes
  node.post("/message", async (req, res) => {
    let { k, x, messageType } = req.body;
    if (!isFaulty && !currentNodeState.killed) {
      if (messageType == "propose") {
        if (!proposals.has(k)) {
          proposals.set(k, []);
        }
        proposals.get(k)!.push(x);
        let proposal = proposals.get(k)!;

        if (proposal.length >= (N - F)) {
          let count0 = proposal.filter((el) => el == 0).length;
          let count1 = proposal.filter((el) => el == 1).length;
          if (count0 > (N / 2)) {
            x = 0;
          } else if (count1 > (N / 2)) {
            x = 1;
          } else {
            x = "?";
          }
          for (let i = 0; i < N; i++) {
            sendMessage(`http://localhost:${BASE_NODE_PORT + i}/message`, { k: k, x: x, messageType: "vote" });
          }
        }
      } else if (messageType == "vote") {
        if (!votes.has(k)) {
          votes.set(k, []);
        }
        votes.get(k)!.push(x);
        let vote = votes.get(k)!;
        if (vote.length >= (N - F)) {
          let count0 = vote.filter((el) => el == 0).length;
          let count1 = vote.filter((el) => el == 1).length;

          if (count0 >= F + 1) {
            currentNodeState.x = 0;
            currentNodeState.decided = true;
          } else if (count1 >= F + 1) {
            currentNodeState.x = 1;
            currentNodeState.decided = true;
          } else {
            if (count0 + count1 > 0 && count0 > count1) {
              currentNodeState.x = 0;
            } else if (count0 + count1 > 0 && count0 < count1) {
              currentNodeState.x = 1;
            } else {
              currentNodeState.x = Math.random() > 0.5 ? 0 : 1;
            }
            currentNodeState.k = k + 1;

            for (let i = 0; i < N; i++) {
              sendMessage(`http://localhost:${BASE_NODE_PORT + i}/message`, { k: currentNodeState.k, x: currentNodeState.x, messageType: "propose" });
            }
          }
        }
      }
    }
    res.status(200).send("Message received and processed.");
  });

  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(`Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`);
    setNodeIsReady(nodeId);
  });

  return server;
}



function sendMessage(url: string, body: any):void {
  const bodyData = JSON.stringify(body);
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyData),
    }
  };

  const req = http.request(url, options, (res: http.IncomingMessage) => {
    let responseData = '';
    res.on('data', (chunk) => {
      responseData += chunk;
    });
    res.on('end', () => {
      try {
        if (res.headers['content-type']?.includes('application/json')) {
          const jsonData = JSON.parse(responseData);
          console.log(jsonData); // Do something with jsonData
        }
      } catch (error) {
        console.error('Error parsing JSON response:', error);
      }
    });
  });

  req.on('error', (error) => {
    // Handle error
  });

  req.write(JSON.stringify(body));
  req.end();
}
