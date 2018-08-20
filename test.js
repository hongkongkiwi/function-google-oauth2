'use strict'

require('dotenv').config()

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
