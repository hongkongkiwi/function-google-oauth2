'use strict'

const path = require('path')
const yaml = require('js-yaml')
const fs = require('fs')
const isArray = require('lodash.isarray')

let config
try {
  config = yaml.safeLoad(fs.readFileSync(path.join(__dirname, '.env.yaml'), 'utf8'))
  for (let varName in config) {
    if (isArray(config[varName])) {
      process.env[varName] = config[varName].join(',')
    } else {
      process.env[varName] = config[varName]
    }
  }
} catch (e) {
  console.error(e)
  process.exit(1)
}

const func = require('./index')

const req = {
  method: 'GET',
  url: 'http://localhost:8201/?error=&code='
  // query: {}
  // query: {
  //   error: '',
  //   code: ''
  // }
}

const res = {
  redirect: (url) => {
    console.log('RES REDIRECT:',url)
  },
  end: (msg) => {
    console.log('RES END:',msg)
  },
  writeHead: (statusCode, opts) => {
    console.log('RES WRITEHEAD:',statusCode,opts)
  }
}

;(async () => {
  await func.http(req, res)
})()
