const CAFECALC_CONFIG = {
  SPREADSHEET_ID: '10HdjasFQ9zVkdcXw9eTQe-DKKGgz6ShbhKkVqGXrxA8',
  OWNER_SALT_PROPERTY: 'OWNER_HASH_SALT',
  AUTH_SECRET_PROPERTY: 'AUTH_SECRET',
  PASSWORD_ITERATIONS: 6000,
  SESSION_HOURS: 12,
  MAX_FAILED_LOGINS: 5,
  LOCK_MINUTES: 15,
  SHEETS: {
    USERS: 'usuarios',
    SESSIONS: 'sessoes',
    RECORDS: 'lancamentos',
    AUDIT: 'auditoria'
  }
};

const RECORD_HEADERS = [
  'id',
  'ownerKey',
  'createdAt',
  'updatedAt',
  'cryptoVersion',
  'encryptedPayload',
  'clientMeta'
];

const USER_HEADERS = [
  'ownerKey',
  'emailHash',
  'emailDisplay',
  'name',
  'passwordSalt',
  'passwordHash',
  'createdAt',
  'lastSeen',
  'failedLogins',
  'lockUntil'
];

const SESSION_HEADERS = [
  'tokenHash',
  'ownerKey',
  'createdAt',
  'expiresAt',
  'lastSeen',
  'revokedAt'
];

const AUDIT_HEADERS = ['at', 'ownerKey', 'action', 'recordId'];

const USER_COL = {
  OWNER_KEY: 0,
  EMAIL_HASH: 1,
  EMAIL_DISPLAY: 2,
  NAME: 3,
  PASSWORD_SALT: 4,
  PASSWORD_HASH: 5,
  CREATED_AT: 6,
  LAST_SEEN: 7,
  FAILED_LOGINS: 8,
  LOCK_UNTIL: 9
};

const SESSION_COL = {
  TOKEN_HASH: 0,
  OWNER_KEY: 1,
  CREATED_AT: 2,
  EXPIRES_AT: 3,
  LAST_SEEN: 4,
  REVOKED_AT: 5
};

function doGet() {
  return HtmlService
    .createTemplateFromFile('Index')
    .evaluate()
    .setTitle('CafeCalc Rural')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    return json_(cafeCalcApi(body));
  } catch (error) {
    return json_({ ok: false, error: publicError_(error) });
  }
}

function cafeCalcApi(request) {
  const action = String(request && request.action || '');
  const payload = request && request.payload || {};
  const ss = SpreadsheetApp.openById(CAFECALC_CONFIG.SPREADSHEET_ID);
  ensureSheets_(ss);

  if (action === 'register') {
    return withLock_(function () {
      return registerUser_(ss, payload);
    });
  }

  if (action === 'login') {
    return withLock_(function () {
      return loginUser_(ss, payload);
    });
  }

  if (action === 'logout') {
    return withLock_(function () {
      revokeSession_(ss, request && request.sessionToken);
      return { ok: true };
    });
  }

  const user = requireSession_(ss, request && request.sessionToken);

  if (action === 'resumeSession' || action === 'profile') {
    return { ok: true, user: publicUser_(user) };
  }

  if (action === 'listRecords') {
    return { ok: true, records: listRecords_(ss, user.ownerKey) };
  }

  if (action === 'saveRecord') {
    return withLock_(function () {
      const record = saveRecord_(ss, user.ownerKey, payload);
      audit_(ss, user.ownerKey, 'saveRecord', record.id);
      return { ok: true, record };
    });
  }

  if (action === 'deleteRecord') {
    return withLock_(function () {
      deleteRecord_(ss, user.ownerKey, payload.id);
      audit_(ss, user.ownerKey, 'deleteRecord', payload.id);
      return { ok: true };
    });
  }

  throw new Error('Ação não permitida.');
}

function registerUser_(ss, payload) {
  const email = normalizeEmail_(payload.email);
  const password = normalizePassword_(payload.password);
  const name = cleanText_(payload.name || 'Produtor', 100) || 'Produtor';
  const emailHash = hashEmail_(email);
  const sheet = ss.getSheetByName(CAFECALC_CONFIG.SHEETS.USERS);
  const existing = findUserByEmailHash_(sheet, emailHash) || findUserByEmailHash_(sheet, legacyHashEmail_(email));
  const now = new Date().toISOString();
  const passwordSalt = Utilities.getUuid() + Utilities.getUuid();
  const passwordHash = derivePasswordHash_(password, passwordSalt);

  let row;
  if (existing && existing.row[USER_COL.PASSWORD_HASH]) {
    throw new Error('Já existe uma conta com este e-mail. Use Entrar.');
  }

  if (existing) {
    row = normalizeUserRow_(existing.row);
    row[USER_COL.EMAIL_HASH] = emailHash;
    row[USER_COL.EMAIL_DISPLAY] = maskEmail_(email);
    row[USER_COL.NAME] = name;
    row[USER_COL.PASSWORD_SALT] = passwordSalt;
    row[USER_COL.PASSWORD_HASH] = passwordHash;
    row[USER_COL.CREATED_AT] = row[USER_COL.CREATED_AT] || now;
    row[USER_COL.LAST_SEEN] = now;
    row[USER_COL.FAILED_LOGINS] = 0;
    row[USER_COL.LOCK_UNTIL] = '';
    sheet.getRange(existing.rowNumber, 1, 1, USER_HEADERS.length).setValues([row]);
  } else {
    row = [
      sha256_(Utilities.getUuid() + emailHash + getOwnerSalt_()),
      emailHash,
      maskEmail_(email),
      name,
      passwordSalt,
      passwordHash,
      now,
      now,
      0,
      ''
    ];
    sheet.appendRow(row);
  }

  const session = createSession_(ss, row[USER_COL.OWNER_KEY]);
  audit_(ss, row[USER_COL.OWNER_KEY], 'register', '');
  return {
    ok: true,
    user: publicUser_(row),
    sessionToken: session.token,
    expiresAt: session.expiresAt
  };
}

function loginUser_(ss, payload) {
  const email = normalizeEmail_(payload.email);
  const password = normalizePassword_(payload.password);
  const emailHash = hashEmail_(email);
  const sheet = ss.getSheetByName(CAFECALC_CONFIG.SHEETS.USERS);
  const found = findUserByEmailHash_(sheet, emailHash);

  if (!found) {
    Utilities.sleep(500);
    throw new Error('E-mail ou senha inválidos.');
  }

  const row = normalizeUserRow_(found.row);
  assertUserNotLocked_(row);

  if (!row[USER_COL.PASSWORD_HASH]) {
    throw new Error('Esta conta ainda não tem senha do site. Use Criar conta para definir uma senha.');
  }

  const valid = verifyPassword_(password, row[USER_COL.PASSWORD_SALT], row[USER_COL.PASSWORD_HASH]);
  if (!valid) {
    registerFailedLogin_(sheet, found.rowNumber, row);
    Utilities.sleep(500);
    throw new Error('E-mail ou senha inválidos.');
  }

  row[USER_COL.LAST_SEEN] = new Date().toISOString();
  row[USER_COL.FAILED_LOGINS] = 0;
  row[USER_COL.LOCK_UNTIL] = '';
  sheet.getRange(found.rowNumber, 1, 1, USER_HEADERS.length).setValues([row]);

  const session = createSession_(ss, row[USER_COL.OWNER_KEY]);
  audit_(ss, row[USER_COL.OWNER_KEY], 'login', '');
  return {
    ok: true,
    user: publicUser_(row),
    sessionToken: session.token,
    expiresAt: session.expiresAt
  };
}

function requireSession_(ss, sessionToken) {
  const token = cleanText_(sessionToken || '', 240);
  if (!token) {
    throw new Error('Sessão expirada. Entre novamente.');
  }

  const sessions = ss.getSheetByName(CAFECALC_CONFIG.SHEETS.SESSIONS);
  const tokenHash = hashSessionToken_(token);
  const rows = sessions.getDataRange().getValues();
  const now = new Date();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[SESSION_COL.TOKEN_HASH] !== tokenHash) continue;

    if (row[SESSION_COL.REVOKED_AT]) {
      throw new Error('Sessão encerrada. Entre novamente.');
    }

    if (!row[SESSION_COL.EXPIRES_AT] || new Date(row[SESSION_COL.EXPIRES_AT]) <= now) {
      throw new Error('Sessão expirada. Entre novamente.');
    }

    sessions.getRange(i + 1, SESSION_COL.LAST_SEEN + 1).setValue(now.toISOString());
    const user = findUserByOwnerKey_(ss.getSheetByName(CAFECALC_CONFIG.SHEETS.USERS), row[SESSION_COL.OWNER_KEY]);
    if (!user) {
      throw new Error('Usuário não encontrado.');
    }

    const userRow = normalizeUserRow_(user.row);
    userRow[USER_COL.LAST_SEEN] = now.toISOString();
    ss.getSheetByName(CAFECALC_CONFIG.SHEETS.USERS)
      .getRange(user.rowNumber, 1, 1, USER_HEADERS.length)
      .setValues([userRow]);

    return {
      ownerKey: userRow[USER_COL.OWNER_KEY],
      name: userRow[USER_COL.NAME] || 'Produtor',
      email: userRow[USER_COL.EMAIL_DISPLAY] || 'conta protegida'
    };
  }

  throw new Error('Sessão expirada. Entre novamente.');
}

function createSession_(ss, ownerKey) {
  const sheet = ss.getSheetByName(CAFECALC_CONFIG.SHEETS.SESSIONS);
  purgeOldSessions_(sheet);

  const token = [Utilities.getUuid(), Utilities.getUuid(), Utilities.getUuid()].join('.');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CAFECALC_CONFIG.SESSION_HOURS * 60 * 60 * 1000).toISOString();
  sheet.appendRow([
    hashSessionToken_(token),
    ownerKey,
    now.toISOString(),
    expiresAt,
    now.toISOString(),
    ''
  ]);

  return { token, expiresAt };
}

function revokeSession_(ss, sessionToken) {
  const token = cleanText_(sessionToken || '', 240);
  if (!token) return;

  const sheet = ss.getSheetByName(CAFECALC_CONFIG.SHEETS.SESSIONS);
  const tokenHash = hashSessionToken_(token);
  const rows = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][SESSION_COL.TOKEN_HASH] === tokenHash && !rows[i][SESSION_COL.REVOKED_AT]) {
      sheet.getRange(i + 1, SESSION_COL.REVOKED_AT + 1).setValue(new Date().toISOString());
      return;
    }
  }
}

function purgeOldSessions_(sheet) {
  const rows = sheet.getDataRange().getValues();
  const limit = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  for (let i = rows.length - 1; i >= 1; i--) {
    const expiresAt = rows[i][SESSION_COL.EXPIRES_AT];
    const revokedAt = rows[i][SESSION_COL.REVOKED_AT];
    if ((expiresAt && new Date(expiresAt) < limit) || (revokedAt && new Date(revokedAt) < limit)) {
      sheet.deleteRow(i + 1);
    }
  }
}

function assertUserNotLocked_(row) {
  const lockUntil = row[USER_COL.LOCK_UNTIL];
  if (lockUntil && new Date(lockUntil) > new Date()) {
    throw new Error('Conta temporariamente bloqueada por excesso de tentativas. Tente novamente em alguns minutos.');
  }
}

function registerFailedLogin_(sheet, rowNumber, row) {
  let failed = Number(row[USER_COL.FAILED_LOGINS] || 0) + 1;
  let lockUntil = '';

  if (failed >= CAFECALC_CONFIG.MAX_FAILED_LOGINS) {
    failed = 0;
    lockUntil = new Date(Date.now() + CAFECALC_CONFIG.LOCK_MINUTES * 60 * 1000).toISOString();
  }

  sheet.getRange(rowNumber, USER_COL.FAILED_LOGINS + 1).setValue(failed);
  sheet.getRange(rowNumber, USER_COL.LOCK_UNTIL + 1).setValue(lockUntil);
}

function findUserByEmailHash_(sheet, emailHash) {
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][USER_COL.EMAIL_HASH] === emailHash) {
      return { row: rows[i], rowNumber: i + 1 };
    }
  }
  return null;
}

function findUserByOwnerKey_(sheet, ownerKey) {
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][USER_COL.OWNER_KEY] === ownerKey) {
      return { row: rows[i], rowNumber: i + 1 };
    }
  }
  return null;
}

function normalizeUserRow_(row) {
  const normalized = USER_HEADERS.map(function (_, index) {
    return row[index] || '';
  });
  normalized[USER_COL.FAILED_LOGINS] = Number(normalized[USER_COL.FAILED_LOGINS] || 0);
  return normalized;
}

function publicUser_(user) {
  return {
    name: user.name || user[USER_COL.NAME] || 'Produtor',
    email: user.email || user[USER_COL.EMAIL_DISPLAY] || 'conta protegida'
  };
}

function listRecords_(ss, ownerKey) {
  const sheet = ss.getSheetByName(CAFECALC_CONFIG.SHEETS.RECORDS);
  const rows = sheet.getDataRange().getValues();
  return rows.slice(1)
    .filter(function (row) {
      return row[1] === ownerKey;
    })
    .map(rowToRecord_)
    .sort(function (a, b) {
      return String(b.updatedAt || b.createdAt || b.date).localeCompare(String(a.updatedAt || a.createdAt || a.date));
    });
}

function saveRecord_(ss, ownerKey, payload) {
  const sheet = ss.getSheetByName(CAFECALC_CONFIG.SHEETS.RECORDS);
  const rows = sheet.getDataRange().getValues();
  const now = new Date().toISOString();
  const id = cleanText_(payload.id || Utilities.getUuid(), 80);
  const record = sanitizeEncryptedRecord_(payload, id, now);

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === id && rows[i][1] !== ownerKey) {
      throw new Error('Registro pertence a outro usuário.');
    }

    if (rows[i][0] === id && rows[i][1] === ownerKey) {
      record.createdAt = cleanText_(rows[i][2] || record.createdAt, 40);
      sheet.getRange(i + 1, 1, 1, RECORD_HEADERS.length).setValues([recordToRow_(record, ownerKey)]);
      return record;
    }
  }

  sheet.appendRow(recordToRow_(record, ownerKey));
  return record;
}

function deleteRecord_(ss, ownerKey, id) {
  const sheet = ss.getSheetByName(CAFECALC_CONFIG.SHEETS.RECORDS);
  const rows = sheet.getDataRange().getValues();
  const targetId = cleanText_(id, 80);

  for (let i = rows.length - 1; i >= 1; i--) {
    if (rows[i][0] === targetId && rows[i][1] === ownerKey) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
}

function sanitizeEncryptedRecord_(payload, id, now) {
  const encryptedPayload = cleanText_(payload.encryptedPayload || '', 50000);
  if (!encryptedPayload) {
    throw new Error('Registro protegido inválido.');
  }

  return {
    id,
    createdAt: cleanText_(payload.createdAt || now, 40),
    updatedAt: now,
    cryptoVersion: cleanText_(payload.cryptoVersion || 'client-aes-gcm-v2', 40),
    encryptedPayload,
    clientMeta: cleanText_(payload.clientMeta || '', 1000)
  };
}

function recordToRow_(record, ownerKey) {
  return [
    record.id,
    ownerKey,
    record.createdAt,
    record.updatedAt,
    record.cryptoVersion,
    record.encryptedPayload,
    record.clientMeta
  ];
}

function rowToRecord_(row) {
  if (looksEncryptedPayload_(row[5])) {
    return {
      id: row[0],
      createdAt: row[2],
      updatedAt: row[3],
      cryptoVersion: row[4] || 'client-aes-gcm-v2',
      encryptedPayload: row[5],
      clientMeta: row[6] || ''
    };
  }

  if (looksEncryptedPayload_(row[4])) {
    return {
      id: row[0],
      createdAt: row[2],
      updatedAt: row[3],
      cryptoVersion: 'client-aes-gcm-v2',
      encryptedPayload: row[4],
      clientMeta: row[5] || ''
    };
  }

  return legacyRowToRecord_(row);
}

function looksEncryptedPayload_(value) {
  const text = String(value || '').trim();
  return text.indexOf('"iv"') !== -1 && text.indexOf('"data"') !== -1;
}

function legacyRowToRecord_(row) {
  return {
    id: row[0],
    kind: 'plan',
    createdAt: row[2],
    updatedAt: row[3],
    date: row[4],
    cropName: row[5] || 'Safra importada',
    coffeeType: row[6],
    bags: Number(row[7] || 0),
    hectares: Number(row[8] || 0),
    useMarket: false,
    manualPrice: Number(row[9] || 0),
    baseCosts: {
      mao_obra: Number(row[10] || 0),
      fertilizantes: Number(row[11] || 0),
      defensivos: Number(row[12] || 0),
      colheita: Number(row[13] || 0),
      maquinario: Number(row[14] || 0),
      outros: Number(row[15] || 0) + Number(row[17] || 0),
      transporte: Number(row[16] || 0),
      compras: 0,
      combustivel: 0,
      manutencao: 0,
      irrigacao: 0
    },
    notes: row[18] || ''
  };
}

function ensureSheets_(ss) {
  ensureSheet_(ss, CAFECALC_CONFIG.SHEETS.USERS, USER_HEADERS);
  ensureSheet_(ss, CAFECALC_CONFIG.SHEETS.SESSIONS, SESSION_HEADERS);
  ensureSheet_(ss, CAFECALC_CONFIG.SHEETS.RECORDS, RECORD_HEADERS);
  ensureSheet_(ss, CAFECALC_CONFIG.SHEETS.AUDIT, AUDIT_HEADERS);
}

function ensureSheet_(ss, name, headers) {
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    return sheet;
  }

  const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const missing = headers.some(function (header, index) {
    return current[index] !== header;
  });

  if (missing) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function audit_(ss, ownerKey, action, recordId) {
  ss.getSheetByName(CAFECALC_CONFIG.SHEETS.AUDIT)
    .appendRow([new Date().toISOString(), ownerKey, action, cleanText_(recordId || '', 80)]);
}

function normalizeEmail_(value) {
  const email = cleanText_(value || '', 160).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new Error('Informe um e-mail válido.');
  }
  return email;
}

function normalizePassword_(value) {
  const password = String(value || '');
  if (password.length < 8) {
    throw new Error('Use uma senha com pelo menos 8 caracteres.');
  }
  if (password.length > 128) {
    throw new Error('Use uma senha com até 128 caracteres.');
  }
  return password;
}

function maskEmail_(email) {
  const parts = email.split('@');
  const name = parts[0] || '';
  const domain = parts[1] || '';
  const visible = name.length <= 2 ? name.slice(0, 1) : name.slice(0, 2);
  return visible + '***@' + domain;
}

function hashEmail_(email) {
  return sha256_(email + ':' + getOwnerSalt_());
}

function legacyHashEmail_(email) {
  return sha256_(email + getOwnerSalt_());
}

function derivePasswordHash_(password, salt) {
  return 'v1$' + CAFECALC_CONFIG.PASSWORD_ITERATIONS + '$' +
    passwordDigest_(password, salt, CAFECALC_CONFIG.PASSWORD_ITERATIONS);
}

function verifyPassword_(password, salt, storedHash) {
  const parts = String(storedHash || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'v1') return false;

  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations < 1000 || iterations > 50000) return false;

  const candidate = 'v1$' + iterations + '$' + passwordDigest_(password, salt, iterations);
  return secureCompare_(candidate, storedHash);
}

function passwordDigest_(password, salt, iterations) {
  const secret = getAuthSecret_();
  let hash = sha256_(salt + ':' + secret + ':' + password);

  for (let i = 0; i < iterations; i++) {
    hash = sha256_(hash + ':' + salt + ':' + secret + ':' + password);
  }

  return hash;
}

function hashSessionToken_(token) {
  return sha256_(String(token || '') + ':' + getAuthSecret_());
}

function secureCompare_(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (!left || !right) return false;

  let mismatch = left.length === right.length ? 0 : 1;
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i++) {
    mismatch |= left.charCodeAt(i % left.length) ^ right.charCodeAt(i % right.length);
  }

  return mismatch === 0;
}

function getOwnerSalt_() {
  const props = PropertiesService.getScriptProperties();
  let salt = props.getProperty(CAFECALC_CONFIG.OWNER_SALT_PROPERTY);
  if (!salt) {
    salt = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty(CAFECALC_CONFIG.OWNER_SALT_PROPERTY, salt);
  }
  return salt;
}

function getAuthSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty(CAFECALC_CONFIG.AUTH_SECRET_PROPERTY);
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
    props.setProperty(CAFECALC_CONFIG.AUTH_SECRET_PROPERTY, secret);
  }
  return secret;
}

function cleanNumber_(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.round(number * 100) / 100;
}

function cleanDate_(value) {
  const text = cleanText_(value || '', 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : new Date().toISOString().slice(0, 10);
}

function cleanText_(value, maxLength) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLength);
}

function sha256_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text)
    .map(function (byte) {
      const value = (byte < 0 ? byte + 256 : byte).toString(16);
      return value.length === 1 ? '0' + value : value;
    })
    .join('');
}

function withLock_(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function publicError_(error) {
  return error && error.message ? error.message : 'Erro inesperado.';
}

function pegarPrecoCafe() {
  return 1716.3;
}
