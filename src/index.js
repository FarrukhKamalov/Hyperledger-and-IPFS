/*
 * Copyright IBM Corp. All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

const grpc = require('@grpc/grpc-js');
const { connect, signers } = require('@hyperledger/fabric-gateway');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { TextDecoder } = require('node:util');

const channelName = envOrDefault('CHANNEL_NAME', 'mychannel');
const chaincodeName = envOrDefault('CHAINCODE_NAME', 'basic');
const mspId = envOrDefault('MSP_ID', 'Org1MSP');


const cryptoPath = envOrDefault(
    'CRYPTO_PATH',
    path.resolve(
        __dirname,
        '..',
        'fabric-samples',
        'test-network',
        'organizations',
        'peerOrganizations',
        'org1.example.com'
    )
);


const keyDirectoryPath = envOrDefault(
    'KEY_DIRECTORY_PATH',
    path.resolve(
        cryptoPath,
        'users',
        'User1@org1.example.com',
        'msp',
        'keystore'
    )
);


const certDirectoryPath = envOrDefault(
    'CERT_DIRECTORY_PATH',
    path.resolve(
        cryptoPath,
        'users',
        'User1@org1.example.com',
        'msp',
        'signcerts'
    )
);


const tlsCertPath = envOrDefault(
    'TLS_CERT_PATH',
    path.resolve(cryptoPath, 'peers', 'peer0.org1.example.com', 'tls', 'ca.crt')
);


const peerEndpoint = envOrDefault('PEER_ENDPOINT', 'localhost:7051');

const peerHostAlias = envOrDefault('PEER_HOST_ALIAS', 'peer0.org1.example.com');

const utf8Decoder = new TextDecoder();
const assetId = `asset${String(Date.now())}`;

async function main() {
    displayInputParameters();

    const client = await newGrpcConnection();
    const gateway = connect({
        client,
        identity: await newIdentity(),
        signer: await newSigner(),
       
        evaluateOptions: () => {
            return { deadline: Date.now() + 5000 }; 
        },
        endorseOptions: () => {
            return { deadline: Date.now() + 15000 }; 
        },
        submitOptions: () => {
            return { deadline: Date.now() + 5000 }; 
        },
        commitStatusOptions: () => {
            return { deadline: Date.now() + 60000 }; 
        },
    });

    try {
        
        const network = gateway.getNetwork(channelName);

        
        const contract = network.getContract(chaincodeName);

        await initLedger(contract);

        
        await getAllAssets(contract);

        await createAsset(contract);

        await transferAssetAsync(contract);

        await readAssetByID(contract);

        await updateNonExistentAsset(contract);




    } finally {
        gateway.close();
        client.close();
    }
}
main().catch((error) => {
    console.error('FAILED to run the application:', error);
    process.exitCode = 1;
});

async function newGrpcConnection() {
    const tlsRootCert = await fs.readFile(tlsCertPath);
    const tlsCredentials = grpc.credentials.createSsl(tlsRootCert);
    return new grpc.Client(peerEndpoint, tlsCredentials, {
        'grpc.ssl_target_name_override': peerHostAlias,
    });
}

async function newIdentity() {
    const certPath = await getFirstDirFileName(certDirectoryPath);
    const credentials = await fs.readFile(certPath);
    return { mspId, credentials };
}

async function getFirstDirFileName(dirPath) {
    const files = await fs.readdir(dirPath);
    const file = files[0];
    if (!file) {
        throw new Error(`No files in directory: ${dirPath}`);
    }
    return path.join(dirPath, file);
}

async function newSigner() {
    const keyPath = await getFirstDirFileName(keyDirectoryPath);
    const privateKeyPem = await fs.readFile(keyPath);
    const privateKey = crypto.createPrivateKey(privateKeyPem);
    return signers.newPrivateKeySigner(privateKey);
}


async function initLedger(contract) {
    console.log(
        '\n--> Submit Transaction: InitLedger, function creates the initial set of assets on the ledger'
    );

    await contract.submitTransaction('InitLedger');

    console.log('Transaction committed successfully');
}

async function getAllAssets(contract) {
    console.log(
        '\n--> Evaluate Transaction: GetAllAssets, function returns all the current assets on the ledger'
    );

    const resultBytes = await contract.evaluateTransaction('GetAllAssets');

    const resultJson = utf8Decoder.decode(resultBytes);
    const result = JSON.parse(resultJson);
    console.log('Result:', result);
}

async function createAsset(contract) {
    console.log(
        '\n--> Submit Transaction: CreateAsset, creates new asset with ID, Color, Size, Owner and AppraisedValue arguments'
    );

    await contract.submitTransaction(
        'CreateAsset',
        assetId,
        'yellow',
        '5',
        'Tom',
        '1300'
    );

    console.log('Transaction committed successfully');
}






async function transferAssetAsync(contract) {
    console.log(
        '\n--> Async Submit Transaction: TransferAsset, updates existing asset owner'
    );

    const commit = await contract.submitAsync('TransferAsset', {
        arguments: [assetId, 'Saptha'],
    });
    const oldOwner = utf8Decoder.decode(commit.getResult());

    console.log(
        `Successfully submitted transaction to transfer ownership from ${oldOwner} to Saptha`
    );
    console.log('Waiting for transaction commit');
    
    const status = await commit.getStatus();
    if (!status.successful) {
        throw new Error(
            `Transaction ${
                status.transactionId
            } failed to commit with status code ${String(status.code)}`
        );
    }

    console.log('Transaction committed successfully');
}

async function readAssetByID(contract) {
    console.log(
        '\n--> Evaluate Transaction: ReadAsset, function returns asset attributes'
    );

    const resultBytes = await contract.evaluateTransaction(
        'ReadAsset',
        assetId
    );

    const resultJson = utf8Decoder.decode(resultBytes);
    const result = JSON.parse(resultJson);
    console.log('Result:', result);
}

async function updateNonExistentAsset(contract) {
    console.log(
        '\n--> Submit Transaction: UpdateAsset asset70, asset70 does not exist and should return an error'
    );

    try {
        await contract.submitTransaction(
            'UpdateAsset',
            'asset70',
            'blue',
            '5',
            'Tomoko',
            '300'
        );
        console.log('FAILED to return an error');
    } catch (error) {
        console.log('Successfully caught the error: \n', error);
    }
}

function envOrDefault(key, defaultValue) {
    return process.env[key] || defaultValue;
}

function displayInputParameters() {
    console.log(`channelName:       ${channelName}`);
    console.log(`chaincodeName:     ${chaincodeName}`);
    console.log(`mspId:             ${mspId}`);
    console.log(`cryptoPath:        ${cryptoPath}`);
    console.log(`keyDirectoryPath:  ${keyDirectoryPath}`);
    console.log(`certDirectoryPath: ${certDirectoryPath}`);
    console.log(`tlsCertPath:       ${tlsCertPath}`);
    console.log(`peerEndpoint:      ${peerEndpoint}`);
    console.log(`peerHostAlias:     ${peerHostAlias}`);
}
