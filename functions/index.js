// The Cloud Functions are added progressively, starting with M2 (see SRS §7.2 and §9).
const { finalizeKyc } = require('./src/kyc')

exports.finalizeKyc = finalizeKyc
