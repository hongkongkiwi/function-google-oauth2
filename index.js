'use strict'

const {OAuth2Client} = require('google-auth-library')
const Storage = require('@google-cloud/storage')
const fs = require('mz/fs')
const mktemp = require('mktemp')
const {promisify} = require('util')
const createTempFile = promisify(require('mktemp').createFile)
const has = require('lodash.has')
const isNull = require('lodash.isnull')
const {Buffer} = require('safe-buffer')
const querystring = require('querystring')
const url = require('url')

// Variables
const redirectUrl = process.env.HTTP_TRIGGER_ENDPOINT + process.env.REDIRECT_PATH
const scopes = process.env.OAUTH2_AUTH_SCOPES ? JSON.parse(process.env.OAUTH2_AUTH_SCOPES) : []
const accessType = process.env.OAUTH2_AUTH_ACCESS_TYPE
const projectId = process.env.GCP_PROJECT
const bucketName = process.env.OAUTH2_STORAGE_BUCKET
const storageTokenFile = process.env.OAUTH2_STORAGE_TOKEN_FILE || 'token.json'
const storageKeysFile = process.env.OAUTH2_STORAGE_KEY_FILE || 'key.json'
const encryptionKey = process.env.OAUTH2_ENCRYPTION_KEY ? Buffer.from(process.env.OAUTH2_ENCRYPTION_KEY, 'base64') : null

const storage = new Storage({
  projectId: projectId,
})
const bucket = storage.bucket(bucketName)

// const handlePost = (request, response) => {
//   const busboy = new Busboy({ headers: req.headers })
//   busboy.on('file', function(fieldname, file, filename, encoding, mimetype) {
//     console.log('File [' + fieldname + ']: filename: ' + filename + ', encoding: ' + encoding + ', mimetype: ' + mimetype)
//     file.on('data', function(data) {
//       console.log('File [' + fieldname + '] got ' + data.length + ' bytes')
//     })
//     file.on('end', function() {
//       console.log('File [' + fieldname + '] Finished')
//     })
//   })
//   busboy.on('field', function(fieldname, val, fieldnameTruncated, valTruncated, encoding, mimetype) {
//     console.log('Field [' + fieldname + ']: value: ' + inspect(val))
//   })
//   busboy.on('finish', function() {
//     console.log('Done parsing form!')
//     res.writeHead(303, { Connection: 'close', Location: '/' })
//     res.end()
//   })
//   req.pipe(busboy)
// }

const getKeys = async () => {
  const tempFile = await createTempFile('XXXXXXXXXX.json')
  const file = bucket.file(storageKeysFile)
  let options = {
    destination: tempFile
  }
  if (encryptionKey) options.encryptionKey = encryptionKey
  await file.download(options)
  console.log(`File ${keyFile} downloaded to ${tempFile}.`);
  return tempFile
}

const storeToken = async (srcFilename) => {
  let options = {
    destination: storageTokenFile
  }
  if (encryptionKey) options.encryptionKey = encryptionKey
  await bucket.upload(srcFilename, options)
  console.log(`File ${srcFilename} uploaded to gs://${bucketName}/${storageTokenFile}.`)
}

const handleGet = async (req, res) => {
  const qs = querystring.parse(url.parse(req.url).query)

  // Handle Error
  if (has(qs, 'error') && !isNull(qs.error)) {
    console.log('FAILED! Got Error',qs.error)
    return handleError('Failed to get code :-( Please retry!', res)
  }

  const keys = await getKeys()
  const oAuth2Client = new OAuth2Client(
    keys.web.client_id,
    keys.web.client_secret,
    keys.web.redirect_uris[0]
  );

  // Handle Blank Request
  if (!has(qs, 'code')) {
    oAuth2Client._redirectUri = redirectUrl
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: accessType,
      scope: scopes
    })
    return res.redirect(authUrl)
  }

  // Handle return from Google Oauth2
  const code = req.query.code
  console.log(`Got Authorization Code: ${code}`)
  let token;
  try {
    token = await auth.getToken(code)
    const tempFile = await createTempFile('XXXXXXXXXX.json')
    await fs.writeFile(tempFile, JSON.stringify(token,null,2))
    await storeToken(tempFile)
    await fs.unlink(tempFile)
    console.log('Successfully stored token to cloud storage', res)
  } catch(err) {
    console.error(err)
    await fs.unlink(tempFile)
    return handleError('Error trying to get or save token', res)
  }
  res.end('Successfully Got Code. You can close this page now :-)')
}

const handleError = (msg, res) => {
  console.error(msg)
  res.writeHead(400, { Connection: 'close' })
  res.end('An error occured')
}

/*
*  @function http
*  @param {object} request object received from the caller
*  @param {object} response object created in response to the request
*/
exports.http = async (req, res) => {
  switch (req.method) {
    case 'GET':
      handleGet(req, res)
      break
    default:
      handleError(`Invalid Method ${req.method}`, res)
      break
  }
}

/*
*
*  @function eventHelloWorld
*  @param { Object } event read event from configured pubsub topic
*  @param { Function } callback function
*/
// exports.eventHelloWorld = (event, callback) => {
//   callback(`Hello ${event.data.name || 'World'}!`)
// }
