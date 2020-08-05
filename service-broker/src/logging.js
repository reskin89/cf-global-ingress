const express = require('express');
const logger = require('morgan');
const app = express();

app.use(logger( (tokens, req, res) => {
  return JSON.stringify({
    time: tokens.date(req, res, 'iso'),
    method: tokens.method(req, res),
    url: tokens.url(req, res),
    status: tokens.status(req, res),
    reqLength: tokens.req(req, res, 'content-length'),
    resLength: tokens.res(req, res, 'content-length'),
    reqContentType: tokens.req(req, res, 'content-type'),
    resContentType: tokens.res(req, res, 'content-type'),
    resTime: tokens['response-time'](req, res),
    reqBody: req.body
  });
}));

module.exports = app;
