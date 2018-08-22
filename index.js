'use strict'

const {OAuth2Client} = require('google-auth-library')
const fs = require('mz/fs')
const {has,isNull,isUndefined,isArray} = require('lodash')
const path = require('path')
let url
let querystring
let tmp
let Storage
let yaml

/** Used when running on simulator **/
const yamlFile = path.join(__dirname, '.env.yaml')

if (fs.existsSync(yamlFile)) {
  yaml = yaml || require('js-yaml')
  try {
    const config = yaml.safeLoad(fs.readFileSync(yamlFile, 'utf8'))
    for (let varName in config) {
      process.env[varName] = config[varName]
    }
  } catch (e) {
    console.error(e)
    process.exit(1)
  }
  process.env.HTTP_TRIGGER_ENDPOINT = 'http://localhost:8010/squashed-melon/asia-northeast1/' + process.env.FUNCTION_NAME
}

// Variables
const redirectCallbackPath = "/callback"
const redirectAuthPath = "/auth"
const scopes = process.env.OAUTH2_AUTH_SCOPES ? process.env.OAUTH2_AUTH_SCOPES.split(',') : []
const accessType = process.env.OAUTH2_AUTH_ACCESS_TYPE
const projectId = process.env.GCP_PROJECT
const bucketName = process.env.OAUTH2_STORAGE_BUCKET
const credsOauthClient = process.env.CREDENTIALS_OAUTH_CLIENT ? path.join(__dirname, process.env.CREDENTIALS_OAUTH_CLIENT.split('/').join(path.sep)) : null
const credsStorageService = process.env.CREDENTIALS_STORAGE_SERVICE ? path.join(__dirname, process.env.CREDENTIALS_STORAGE_SERVICE.split('/').join(path.sep)) : null
const redirectUrl = process.env.HTTP_TRIGGER_ENDPOINT + redirectCallbackPath

if (isNull(scopes) ||
    isNull(accessType) ||
    isNull(bucketName) ||
    isNull(credsOauthClient) ||
    isNull(credsStorageService)) {
      throw new Error("Environment Variables not available!")
    }

let bucket
let token
let keys
let storageCreds
let oAuth2Client

const verifyAndExtractToken = async (token) => {
  const ticket = await oAuth2Client.verifyIdToken({
      idToken: token.id_token,
      audience: keys.installed.client_id,  // Specify the CLIENT_ID of the app that accesses the backend
  })
  return ticket.getPayload()
  // console.log(payload)
  // const userid = payload.sub
  // const domain = payload.hd
}

const debugLog = (msg) => {
  console.log(msg)
}

const createTempFile = async () => {
  tmp = tmp || require('tmp-promise')
  return await tmp.tmpName()
}

// const getTokenFile = async (srcFile, encKey) => {
//   const tempFile = await createTempFile()
//   const file = bucket.file(storageTokenFile)
//   const checkFileExists = _=>{
//     return file.exists().then((data)=>{ return data[0] })
//   }
//   if (!await checkFileExists()) {
//     console.log('Token does not exist!')
//     return null
//   }
//   let options = {
//     destination: tempFile
//   }
//   if (encryptionKey) options.encryptionKey = encryptionKey
//   console.log('File Exists trying to download')
//   await file.download(options)
//   debugLog(`File ${storageTokenFile} downloaded to ${tempFile}.`);
//   return tempFile
// }

// const getToken = async () => {
//   const tempTokenFile = await getTokenFile(storageTokenFile, encryptionKey)
//   console.log('tempTokenFile', tempTokenFile)
//   if (isNull(tempTokenFile)) {
//     debugLog("No Token file available from Cloud Storage")
//     return null
//   }
//   debugLog("Got Token File from Cloud Storage")
//   const tokenFileContents = await fs.readFile(tempTokenFile)
//   await fs.unlink(tempTokenFile)
//   return tokenFileContents
// }

const storeToken = async (srcFilename, dstFilename, encKey) => {
  let options = {
    destination: dstFilename
  }
  if (encKey) options.encryptionKey = encKey
  await bucket.upload(srcFilename, options)
  debugLog(`File ${srcFilename} uploaded to gs://${bucketName}/${dstFilename}.`)
}

const getKeys = async () => {
  const keysFileContents = await fs.readFile(credsOauthClient)
  const keys = JSON.parse(keysFileContents)
  if (!has(keys, 'installed') ||
      !has(keys.installed, 'client_id') ||
      !has(keys.installed, 'client_secret') ||
      !has(keys.installed, 'redirect_uris') ||
      !isArray(keys.installed.redirect_uris) ||
      keys.installed.redirect_uris.length === 0) {
        throw new Error('Invalid keys file!')
      }
  return keys
}

const handleGet = async (req, res) => {
  url = url || require('url')
  querystring = querystring || require('querystring')
  const urlPath = url.parse(req.url).path.split('?')[0]
  const urlQS = querystring.parse(url.parse(req.url).query)

  if (urlPath === '/' || (urlPath !== redirectAuthPath && urlPath !== redirectCallbackPath)) {
    console.log(urlPath)
    return handleError('Invalid path passed', res)
  } else {
    Storage = Storage || require('@google-cloud/storage')
    bucket = bucket || new Storage({
                            projectId: projectId,
                            keyFilename: credsStorageService
                        }).bucket(bucketName)
    debugLog("Initialized bucket")
    keys = keys || await getKeys()
    debugLog("Initialized keys" + keys)
    oAuth2Client = oAuth2Client || new OAuth2Client(
                                      keys.installed.client_id,
                                      keys.installed.client_secret,
                                      redirectUrl)
    if (urlPath === redirectAuthPath) {
      //oAuth2Client._redirectUri = redirectUrl
      const authUrl = oAuth2Client.generateAuthUrl({
        access_type: accessType,
        scope: scopes
      })
      return res.redirect(authUrl)
    } else if (urlPath === redirectCallbackPath) {
      if (has(urlQS, 'error') && !isNull(urlQS.error)) {
        debugLog('FAILED! Got Error', urlQS.error)
        return handleError('Failed to get code :-( Please retry!', res)
      }
      if (!has(urlQS, 'code')) {
        debugLog('Invalid return from callback! No code in query')
        return handleError('Invalid callback', res)
      }
      // Handle return from Google Oauth2
      const code = urlQS.code
      debugLog(`Got Authorization Code: ${code}`)
      try {
        token = await oAuth2Client.getToken(code)
        console.log('Got Token', token)
        token = token.tokens
        const tempFile = await createTempFile()
        const details = await verifyAndExtractToken(token)
        if (!has(details, 'email')) {
          return handleError('Email is not available from token! Wrong scope?')
        }
        console.log('Got Token Details', details)
        await fs.writeFile(tempFile, JSON.stringify(token,null,0), {encoding: 'utf8', flag: 'w'})
        const storageTokenFile = 'tokens/' + details.email + '.json'
        await storeToken(tempFile, storageTokenFile)
        await fs.unlink(tempFile)
        debugLog('Successfully stored token to cloud storage', res)
      } catch(err) {
        console.error(err)
        await fs.unlink(tempFile)
        return handleError('Error trying to get or save token', res)
      }
      res.status(200).end('Successfully Got Code. You can close this page now :-)')
    }
  }
}

const handleError = (msg, res) => {
  console.error(msg)
  res.status(400).end('An error occured')
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
