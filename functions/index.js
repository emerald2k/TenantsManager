// The Cloud Functions are added progressively, starting with M2 (see SRS §7.2 and §9).
const { finalizeKyc } = require('./src/kyc')
const { endTenancy } = require('./src/endTenancy')
const { resetTenantPassword } = require('./src/resetTenantPassword')
const { setTenantAccountStatus } = require('./src/setTenantAccountStatus')
const {
  signReport,
  unlockReport,
  onReportWrite,
  sendReportNotification,
} = require('./src/reports')
const { onPropertyUpdate } = require('./src/properties')
const {
  getSharedReport,
  getSharedReportAttachment,
} = require('./src/sharedReport')
const { dailyScheduler } = require('./src/scheduler')

exports.finalizeKyc = finalizeKyc
exports.endTenancy = endTenancy
exports.resetTenantPassword = resetTenantPassword
exports.setTenantAccountStatus = setTenantAccountStatus
exports.signReport = signReport
exports.unlockReport = unlockReport
exports.onReportWrite = onReportWrite
exports.sendReportNotification = sendReportNotification
exports.onPropertyUpdate = onPropertyUpdate
exports.getSharedReport = getSharedReport
exports.getSharedReportAttachment = getSharedReportAttachment
exports.dailyScheduler = dailyScheduler
