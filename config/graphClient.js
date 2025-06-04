const { Client } = require('@microsoft/microsoft-graph-client');
const { ClientSecretCredential } = require('@azure/identity');
require('dotenv').config();
require('isomorphic-fetch'); // fetch global tanımı için

// Azure kimlik bilgileri
const credential = new ClientSecretCredential(
  process.env.TENANT_ID,
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET
);

// authProvider formatı: getAccessToken() metodu olan bir nesne olmalı
const authProvider = {
  getAccessToken: async () => {
    const tokenResponse = await credential.getToken('https://graph.microsoft.com/.default');
    return tokenResponse.token;
  }
};

// Microsoft Graph Client init
const graphClient = Client.initWithMiddleware({ authProvider });

module.exports = graphClient;
