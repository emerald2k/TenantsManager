// The Cloud Functions are added progressively, starting with M2 (see SRS §7.2 and §9).
const { finalizeKyc } = require('./src/kyc')
const { endTenancy } = require('./src/endTenancy')
const { resetTenantPassword } = require('./src/resetTenantPassword')
const { setTenantAccountStatus } = require('./src/setTenantAccountStatus')
const { signReport, unlockReport, onReportWrite } = require('./src/reports')

exports.finalizeKyc = finalizeKyc
exports.endTenancy = endTenancy
exports.resetTenantPassword = resetTenantPassword
exports.setTenantAccountStatus = setTenantAccountStatus
exports.signReport = signReport
exports.unlockReport = unlockReport
exports.onReportWrite = onReportWrite
