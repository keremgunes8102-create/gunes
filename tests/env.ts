// Testler ayrı bir veritabanında çalışır. Bu dosya diğer tüm içe aktarmalardan önce yüklenmelidir.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://koltuk:koltuk_dev@127.0.0.1:5432/koltuk_test';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR ?? `${process.cwd()}/data/test-uploads`;
process.env.DEV_SHOW_CODES = '1';
process.env.EMAIL_PROVIDER = '';
process.env.SMS_PROVIDER = '';
