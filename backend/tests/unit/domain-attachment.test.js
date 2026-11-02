const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const att = require('../../src/domain/attachment')

const bytes = (...parts) => parts.flatMap((p) => (typeof p === 'string' ? Array.from(Buffer.from(p, 'latin1')) : p))
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 13])
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], 'JFIF')
const GIF = bytes('GIF89a', [1, 0])
const WEBP = bytes('RIFF', [0x24, 0, 0, 0], 'WEBPVP8 ')
const PDF = bytes('%PDF-1.7\n')
const ZIP = bytes([0x50, 0x4b, 0x03, 0x04], [20, 0])
const OLE = bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
const TEXT = bytes('nome;valor\nAna;10\n')
const EXE = bytes('MZ', [0x90, 0])

describe('domain/attachment — tipo real pelo conteúdo', () => {
  it('reconhece imagens, PDF e documentos pelo conteúdo + extensão compatível', () => {
    assert.deepEqual(att.classify('print.PNG', PNG), { mime: 'image/png', kind: 'image', ext: 'png' })
    assert.deepEqual(att.classify('foto.jpeg', JPEG), { mime: 'image/jpeg', kind: 'image', ext: 'jpeg' })
    assert.equal(att.classify('anim.gif', GIF).mime, 'image/gif')
    assert.equal(att.classify('img.webp', WEBP).mime, 'image/webp')
    assert.deepEqual(att.classify('contrato.pdf', PDF), { mime: 'application/pdf', kind: 'document', ext: 'pdf' })
    assert.equal(att.classify('planilha.xlsx', ZIP).mime, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    assert.equal(att.classify('antigo.doc', OLE).mime, 'application/msword')
    assert.equal(att.classify('dados.csv', TEXT).mime, 'text/csv')
    assert.deepEqual(att.classify('dump.sql', bytes('-- dump\nCREATE TABLE clientes (id int);\nINSERT INTO clientes VALUES (1);\n')), { mime: 'text/plain', kind: 'document', ext: 'sql' })
    assert.deepEqual(att.classify('dump.sql', bytes('<script>alert(1)</script>')), { error: 'invalid_file' })
    assert.deepEqual(att.classify('dump.sql', [0x50, 0x4b, 0x03, 0x04, 0, 0]), { error: 'type_mismatch' })
    assert.equal(att.classify('log.txt', TEXT).mime, 'text/plain')
  })

  it('nunca confia só na extensão: conteúdo diferente do declarado é recusado', () => {
    assert.deepEqual(att.classify('foto.png', PDF), { error: 'type_mismatch' })
    assert.deepEqual(att.classify('relatorio.pdf', EXE), { error: 'type_mismatch' })
    assert.deepEqual(att.classify('notas.txt', PNG), { error: 'type_mismatch' })
    assert.deepEqual(att.classify('virus.exe', EXE), { error: 'unsupported_type' })
    assert.deepEqual(att.classify('pagina.html', bytes('<html>')), { error: 'unsupported_type' })
    assert.deepEqual(att.classify('logo.svg', bytes('<svg>')), { error: 'unsupported_type' })
    assert.deepEqual(att.classify('sem-extensao', PNG), { error: 'unsupported_type' })
  })

  it('texto que é HTML/XML disfarçado é recusado (segunda barreira, antes feita pelo PocketBase)', () => {
    assert.deepEqual(att.classify('nota.txt', bytes('<!DOCTYPE html><html><script>alert(1)</script></html>')), { error: 'invalid_file' })
    assert.deepEqual(att.classify('nota.txt', bytes([0xef, 0xbb, 0xbf], '  \n<SCRIPT>alert(1)</SCRIPT>')), { error: 'invalid_file' })
    assert.deepEqual(att.classify('dados.csv', bytes('<?xml version="1.0"?><x/>')), { error: 'invalid_file' })
    assert.deepEqual(att.classify('nota.md', bytes('<svg onload="x"/>')), { error: 'invalid_file' })
    assert.deepEqual(att.classify('nota.txt', bytes('<!-- comentário -->')), { error: 'invalid_file' })
    // texto comum que começa com "<" mas não é marcação continua aceito
    assert.equal(att.classify('nota.txt', bytes('<3 obrigado pela ajuda')).mime, 'text/plain')
    assert.equal(att.classify('nota.md', bytes('<abc> não é tag de HTML')).mime, 'text/plain')
  })

  it('nome seguro: sem caminho, sem caracteres de controle, tamanho limitado, extensão preservada', () => {
    assert.equal(att.safeFileName('../../etc/passwd.txt'), 'passwd.txt')
    assert.equal(att.safeFileName('C:\\temp\\Relatório final.pdf'), 'Relatório final.pdf')
    assert.equal(att.safeFileName('a\u0000b<>:"|?*.png'), 'ab_______.png')
    assert.equal(att.safeFileName('x'.repeat(300) + '.pdf').length, 150)
    assert.ok(att.safeFileName('x'.repeat(300) + '.pdf').endsWith('.pdf'))
    assert.equal(att.safeFileName('   '), 'arquivo')
  })

  it('valida tamanho e quantidade', () => {
    assert.equal(att.sizeIssue(0), 'empty_file')
    assert.equal(att.sizeIssue(att.MAX_FILE_SIZE + 1), 'file_too_large')
    assert.equal(att.sizeIssue(1024), null)
  })
})
