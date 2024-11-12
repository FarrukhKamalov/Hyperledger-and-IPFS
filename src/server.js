const express = require("express");
const { Gateway, Wallets } = require("fabric-network");
const path = require("path");
const fs = require("fs/promises");
const cors = require("cors");
const protobuf = require("fabric-protos");
const { randomUUID } = require("crypto");
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: "*" })); // CORS setup

const mspId = "Org1MSP";


let client;
let create;
(async()=>{
  create = await import("kubo-rpc-client").then(module => module.default || module);
  client = await create.create({url: "/ip4/127.0.0.1/tcp/5001"})
})()
// Define paths using CommonJS __dirname
const cryptoPath = envOrDefault(
  "CRYPTO_PATH",
  path.resolve(
    __dirname,
    "..",
    "fabric-samples",
    "test-network",
    "organizations",
    "peerOrganizations",
    "org1.example.com"
  )
);

const certDirectoryPath = envOrDefault(
  "CERT_DIRECTORY_PATH",
  path.resolve(cryptoPath, "users", "User1@org1.example.com", "msp", "signcerts")
);

const keyDirectoryPath = envOrDefault(
  "KEY_DIRECTORY_PATH",
  path.resolve(cryptoPath, "users", "User1@org1.example.com", "msp", "keystore")
);

const ccpPath = path.resolve(__dirname, "connection.json");
const walletPath = path.join(process.cwd(), "wallet");



async function connectToNetwork() {
  const ccp = JSON.parse(await fs.readFile(ccpPath, "utf-8"));
  const wallet = await Wallets.newFileSystemWallet(walletPath);
  const identity = await wallet.get("User1");

  if (!identity) {
    console.log("Creating a new wallet entry for User1");
    await createWalletIdentity(wallet);
  }

  const gateway = new Gateway();
  await gateway.connect(ccp, {
    wallet,
    identity: "User1",
    discovery: {
      enabled: true,
      asLocalhost: true,
    },
  });

  const network = await gateway.getNetwork("mychannel");
  const channel = network.getChannel();
  const contract = network.getContract("basic");

  return { gateway, channel, contract, network };
}

async function createWalletIdentity(wallet) {
  const cert = await getFirstDirFileContent(certDirectoryPath);
  const key = await getFirstDirFileContent(keyDirectoryPath);

  const identity = {
    credentials: {
      certificate: cert,
      privateKey: key,
    },
    mspId: mspId,
    type: "X.509",
  };

  await wallet.put("User1", identity);
}

async function getFirstDirFileContent(dirPath) {
  const files = await fs.readdir(dirPath);
  const file = files[0];
  if (!file) {
    throw new Error(`No files in directory: ${dirPath}`);
  }
  return await fs.readFile(path.join(dirPath, file), "utf8");
}

function envOrDefault(key, defaultValue) {
  return process.env[key] || defaultValue;
}

// API routes
app.get("/", async (req, res) => {
  try {
    const { contract } = await connectToNetwork();
    const resultBytes = await contract.evaluateTransaction("GetAllAssets");
    const resultJson = resultBytes.toString();
    const result = JSON.parse(resultJson);
    res.json({
      data: result,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.toString() });
  }
});

app.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { contract } = await connectToNetwork();
    const resultBytes = await contract.evaluateTransaction("ReadAsset", id);
    const result = JSON.parse(resultBytes.toString());
    res.json(result);
  } catch (error) {
    console.error("Error fetching asset:", error);
    res.status(500).json({ error: error.message });
  }
});

async function createMultipleAssets(contract, numRequests) {
  console.log(
    `\n--> Submit ${numRequests} CreateAsset Transactions, each with unique ID, Color, Size, Owner, and AppraisedValue`
  );

  const transactionPromises = [];

  for (let i = 0; i < numRequests; i++) {
    const assetId = `asset${i + randomUUID()}`;
    const color = "white";
    const size = (100 + i).toString();
    const owner = "kAMALOv";
    const appraisedValue = (1300 + i).toString();

    const assetData = {
      ID: assetId,
      Color: color,
      Size: size,
      Owner: owner,
      AppraisedValue: appraisedValue,
      timestamp: new Date().toISOString(),
    };


    // Store data in IPFS using `block.put`
    const cid = await client.add(JSON.stringify(assetData)); // Store as raw IPFS block
    const cidString = cid.toString(); // Convert CID to string
    console.log(cid);
    console.log(cidString)    // Submit transaction with CID included
    const assetContract = contract.submitTransaction(
      "CreateAsset",
      assetId,
      color,
      size,
      owner,
      appraisedValue,
      cidString // Send CID as metadata
    );

    transactionPromises.push(assetContract);
  }

  await Promise.all(transactionPromises);
  console.log(`${numRequests} Transactions committed successfully`);
}

app.post("/multipleadd", async (req, res) => {
  try {
    const { contract } = await connectToNetwork();

    await createMultipleAssets(contract, req.body.numRequests || 100);
    res.json({
      message: `${req.body.numRequests || 100} assets added successfully.`,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/all/blocks", async (req, res) => {
  try {
    const { network } = await connectToNetwork();
    const contract = network.getContract("qscc");
    const chainInfoBytes = await contract.evaluateTransaction(
      "GetChainInfo",
      "mychannel"
    );

    const resultJson = protobuf.common.BlockchainInfo.decode(chainInfoBytes);
    const latestBlockNum = resultJson.height.low - 1;
    let blocks = [];
    let transactions = [];

    for (let i = 0; i <= latestBlockNum; i++) {
      const blockBytes = await contract.evaluateTransaction(
        "GetBlockByNumber",
        "mychannel",
        String(i)
      );
      const block = protobuf.common.Block.decode(blockBytes);
      transactions.push({
        txId: i,
        transaction: block.data.data,
      });
      blocks.push({
        blockId: i,
        blockHeader: block.header,
        blockData: block.data,
        metadata: block.metadata,
      });
    }
    const blocksLength = blocks.length;
    const transactionsLength = transactions.length;
    res.json({
      data: {
        blocksLength,
        transactionsLength,
        transactions,
        blocks,
      },
      success: true,
    });
  } catch (error) {
    console.error(error);
  }
});

app.listen(9000, () => {
  console.log("Server is running on port 9000");
});
