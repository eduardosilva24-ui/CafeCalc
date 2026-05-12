const CAFECALC_CONFIG = {
  SPREADSHEET_ID: '10HdjasFQ9zVkdcXw9eTQe-DKKGgz6ShbhKkVqGXrxA8',
  CLIENT_ID_PROPERTY: 'GOOGLE_CLIENT_ID',
  OWNER_SALT_PROPERTY: 'OWNER_HASH_SALT',
  SHEETS: {
    USERS: 'usuarios',
    RECORDS: 'lancamentos',
    AUDIT: 'auditoria'
  }
};

const RECORD_HEADERS = [
  'id',
  'ownerKey',
  'createdAt',
  'updatedAt',
  'date',
  'plot',
  'coffeeType',
  'bags',
  'hectares',
  'price',
  'labor',
  'fertilizer',
  'defensive',
  'harvest',
  'machine',
  'drying',
  'transport',
  'other',
  'notes'
];

const USER_HEADERS = ['ownerKey', 'emailHash', 'createdAt', 'lastSeen'];
const AUDIT_HEADERS = ['at', 'ownerKey', 'action', 'recordId'];

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
  const user = verifyGoogleToken_(request && request.token);
  const ss = SpreadsheetApp.openById(CAFECALC_CONFIG.SPREADSHEET_ID);
  ensureSheets_(ss);
  upsertUser_(ss, user);

  if (action === 'listRecords') {
    return { ok: true, records: listRecords_(ss, user.ownerKey) };
  }

  if (action === 'saveRecord') {
    const record = saveRecord_(ss, user.ownerKey, payload);
    audit_(ss, user.ownerKey, 'saveRecord', record.id);
    return { ok: true, record };
  }

  if (action === 'deleteRecord') {
    deleteRecord_(ss, user.ownerKey, payload.id);
    audit_(ss, user.ownerKey, 'deleteRecord', payload.id);
    return { ok: true };
  }

  if (action === 'profile') {
    return { ok: true, profile: { ownerKey: user.ownerKey } };
  }

  throw new Error('Ação não permitida.');
}

function verifyGoogleToken_(idToken) {
  const props = PropertiesService.getScriptProperties();
  const clientId = props.getProperty(CAFECALC_CONFIG.CLIENT_ID_PROPERTY);
  if (!clientId || clientId.indexOf('.apps.googleusercontent.com') === -1) {
    throw new Error('Configure GOOGLE_CLIENT_ID nas propriedades do Apps Script.');
  }

  if (!idToken) {
    throw new Error('Login Google obrigatório.');
  }

  const response = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );

  if (response.getResponseCode() !== 200) {
    throw new Error('Token Google inválido.');
  }

  const data = JSON.parse(response.getContentText());
  if (data.aud !== clientId) {
    throw new Error('Token emitido para outro aplicativo.');
  }

  if (String(data.email_verified) !== 'true') {
    throw new Error('E-mail Google não verificado.');
  }

  return {
    ownerKey: sha256_(String(data.sub) + getOwnerSalt_()),
    emailHash: sha256_(String(data.email || '').toLowerCase() + getOwnerSalt_())
  };
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

function ensureSheets_(ss) {
  ensureSheet_(ss, CAFECALC_CONFIG.SHEETS.USERS, USER_HEADERS);
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
  const missing = headers.some((header, index) => current[index] !== header);
  if (missing) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function upsertUser_(ss, user) {
  const sheet = ss.getSheetByName(CAFECALC_CONFIG.SHEETS.USERS);
  const rows = sheet.getDataRange().getValues();
  const now = new Date().toISOString();

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === user.ownerKey) {
      sheet.getRange(i + 1, 4).setValue(now);
      return;
    }
  }

  sheet.appendRow([user.ownerKey, user.emailHash, now, now]);
}

function listRecords_(ss, ownerKey) {
  const sheet = ss.getSheetByName(CAFECALC_CONFIG.SHEETS.RECORDS);
  const rows = sheet.getDataRange().getValues();
  return rows.slice(1)
    .filter((row) => row[1] === ownerKey)
    .map(rowToRecord_)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function saveRecord_(ss, ownerKey, payload) {
  const sheet = ss.getSheetByName(CAFECALC_CONFIG.SHEETS.RECORDS);
  const rows = sheet.getDataRange().getValues();
  const now = new Date().toISOString();
  const id = cleanText_(payload.id || Utilities.getUuid(), 80);
  const record = sanitizeRecord_(payload, id, now);
  const row = recordToRow_(record, ownerKey);

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === id && rows[i][1] !== ownerKey) {
      throw new Error('Registro pertence a outro usuário.');
    }

    if (rows[i][0] === id && rows[i][1] === ownerKey) {
      row[2] = rows[i][2] || now;
      sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
      return record;
    }
  }

  sheet.appendRow(row);
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

function sanitizeRecord_(payload, id, now) {
  return {
    id,
    createdAt: cleanText_(payload.createdAt || now, 40),
    updatedAt: now,
    date: cleanDate_(payload.date),
    plot: cleanText_(payload.plot || 'Fazenda', 120),
    coffeeType: cleanText_(payload.coffeeType || 'arabica', 40),
    bags: cleanNumber_(payload.bags),
    hectares: cleanNumber_(payload.hectares),
    price: cleanNumber_(payload.price),
    costs: {
      labor: cleanNumber_(payload.costs && payload.costs.labor),
      fertilizer: cleanNumber_(payload.costs && payload.costs.fertilizer),
      defensive: cleanNumber_(payload.costs && payload.costs.defensive),
      harvest: cleanNumber_(payload.costs && payload.costs.harvest),
      machine: cleanNumber_(payload.costs && payload.costs.machine),
      drying: cleanNumber_(payload.costs && payload.costs.drying),
      transport: cleanNumber_(payload.costs && payload.costs.transport),
      other: cleanNumber_(payload.costs && payload.costs.other)
    },
    notes: cleanText_(payload.notes || '', 900)
  };
}

function recordToRow_(record, ownerKey) {
  return [
    record.id,
    ownerKey,
    record.createdAt,
    record.updatedAt,
    record.date,
    record.plot,
    record.coffeeType,
    record.bags,
    record.hectares,
    record.price,
    record.costs.labor,
    record.costs.fertilizer,
    record.costs.defensive,
    record.costs.harvest,
    record.costs.machine,
    record.costs.drying,
    record.costs.transport,
    record.costs.other,
    record.notes
  ];
}

function rowToRecord_(row) {
  return {
    id: row[0],
    createdAt: row[2],
    updatedAt: row[3],
    date: row[4],
    plot: row[5],
    coffeeType: row[6],
    bags: Number(row[7] || 0),
    hectares: Number(row[8] || 0),
    price: Number(row[9] || 0),
    costs: {
      labor: Number(row[10] || 0),
      fertilizer: Number(row[11] || 0),
      defensive: Number(row[12] || 0),
      harvest: Number(row[13] || 0),
      machine: Number(row[14] || 0),
      drying: Number(row[15] || 0),
      transport: Number(row[16] || 0),
      other: Number(row[17] || 0)
    },
    notes: row[18] || ''
  };
}

function audit_(ss, ownerKey, action, recordId) {
  ss.getSheetByName(CAFECALC_CONFIG.SHEETS.AUDIT)
    .appendRow([new Date().toISOString(), ownerKey, action, cleanText_(recordId || '', 80)]);
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
    .map((byte) => {
      const value = (byte < 0 ? byte + 256 : byte).toString(16);
      return value.length === 1 ? '0' + value : value;
    })
    .join('');
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
