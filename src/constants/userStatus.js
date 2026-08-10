const USER_STATUS = {
  ACTIVE: 'ACTIVE',
  BLOCKED: 'BLOCKED',
  // Self-deleted by the user. The document survives with its personal fields
  // scrubbed, because wallet, payment and verification records reference it and
  // must be retained for tax and audit — see user.service.deleteAccount.
  DELETED: 'DELETED',
};

module.exports = USER_STATUS;
