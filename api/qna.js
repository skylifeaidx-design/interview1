const { createQnaHandler } = require('../server/qna-http.cjs');

// No memory/local-file fallback: unconnected deployments return an explicit 503.
module.exports = createQnaHandler();
module.exports.createQnaHandler = createQnaHandler;
