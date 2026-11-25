import importlib.util
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

import fitz


SPEC = importlib.util.spec_from_file_location(
    'publication_pdf_lookup', Path(__file__).parents[1] / 'publication_pdf_lookup.py')
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class MadridPublicationPagesTest(unittest.TestCase):
    def test_indexed_madrid_page_is_prepared_but_missing_number_is_not_guessed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pdf = root / 'CB_275_B_02_2011.pdf'
            source = fitz.open()
            source.new_page().insert_text((50, 50), 'Cover')
            for n in range(2,5):source.new_page().insert_text((50, 50), f'(111) 1024568 page {n}')
            source.save(pdf)
            source.close()
            a_pdf = root / 'CB_274_A_01_2011.pdf'
            a_source = fitz.open()
            a_source.new_page().insert_text((50, 50), '(111) 1024568 A source')
            a_source.save(a_pdf)
            a_source.close()
            database = root / 'publications.sqlite'
            db = sqlite3.connect(database)
            db.executescript('''CREATE TABLE inventory_files (source_path TEXT);
                CREATE TABLE international_publications (
                  record_key TEXT,record_kind TEXT,cb_number INTEGER,source_file TEXT,
                  source_pages TEXT,international_registration_no TEXT,volume TEXT);''')
            db.execute('INSERT INTO inventory_files VALUES (?)', (str(pdf),))
            db.execute('INSERT INTO inventory_files VALUES (?)', (str(a_pdf),))
            db.execute('INSERT INTO international_publications VALUES (?,?,?,?,?,?,?)',
                       ('reg:1024568', 'madrid_registration', 275, pdf.name, '2', '1024568', 'B'))
            db.execute('INSERT INTO international_publications VALUES (?,?,?,?,?,?,?)',
                       ('renew:1024568', 'madrid_renewal', 391, pdf.name, '2–4', '1024568', 'B'))
            db.execute('INSERT INTO international_publications VALUES (?,?,?,?,?,?,?)',
                       ('a:1024568', 'madrid_registration', 274, a_pdf.name, '1', '1024568', 'A'))
            db.commit()
            db.close()
            found = module.prepare_madrid_documents(database, root / 'cache', '1024568')
            self.assertTrue(found['ok'])
            self.assertEqual(len(found['documents']), 3)
            self.assertEqual([item['category'] for item in found['documents']], ['renewal', 'publication_b', 'publication_a'])
            self.assertEqual(found['documents'][0]['sourcePages'], [2,3,4])
            self.assertEqual(found['documents'][0]['sourcePath'],str(pdf.resolve()))
            self.assertEqual(found['documents'][0]['pdfPath'],'')
            self.assertFalse((root/'cache').exists())
            # Noncontiguous order is preserved; invalid pages are withheld.
            db=sqlite3.connect(database)
            db.execute('INSERT INTO international_publications VALUES (?,?,?,?,?,?,?)',
                       ('after:1024568','madrid_grant_after_refusal',392,pdf.name,'4,2','1024568','B'))
            db.execute('INSERT INTO international_publications VALUES (?,?,?,?,?,?,?)',
                       ('invalid:1024568','madrid_renewal',393,pdf.name,'8','1024568','B'))
            db.commit();db.close()
            found=module.prepare_madrid_documents(database,root/'cache','1024568')
            self.assertEqual(found['documents'][0]['category'],'publication_b')
            self.assertEqual(found['documents'][0]['sourcePages'],[4,2])
            self.assertEqual(len(found['documents']),4)
            missing = module.prepare_madrid_documents(database, root / 'cache', '1024572')
            self.assertEqual(missing['documents'], [])
            self.assertFalse(module.prepare_madrid_documents(database, root / 'cache', '../1024568')['ok'])
            other=root/'other';other.mkdir()
            (other/pdf.name).write_bytes(pdf.read_bytes())
            db=sqlite3.connect(database);db.execute('INSERT INTO inventory_files VALUES (?)',(str(other/pdf.name),));db.commit();db.close()
            ambiguous=module.prepare_madrid_documents(database,root/'cache','1024568')
            self.assertEqual([d['category'] for d in ambiguous['documents']],['publication_a'])


class RegistrationHistoryLookupTest(unittest.TestCase):
    def test_application_lookup_accepts_vn_prefixed_history_without_changing_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            publication = root / 'publication.sqlite'
            history = root / 'history.sqlite'
            with closing(sqlite3.connect(publication)) as db:
                db.execute('''CREATE TABLE publication_records (
                    id INTEGER, mode_id TEXT, application_number TEXT,
                    registration_number TEXT, cb_number INTEGER)''')
                db.commit()
            with closing(sqlite3.connect(history)) as db:
                db.execute('CREATE TABLE applications (application_number TEXT, registration_number TEXT)')
                db.executemany('INSERT INTO applications VALUES (?, ?)', [
                    ('VN-4-2018-37767', '4-0534068-000'),
                    ('4-2018-10477', '4-0360843-000'),
                    ('VN-4-2018-37768', '4-0534069-000'),
                ])
                db.commit()
            result = subprocess.run(
                [sys.executable, str(Path(module.__file__)), '--lookup-registrations',
                 str(publication), str(history), str(root / 'missing-repository.sqlite')],
                input=json.dumps({'applicationNos': ['4-2018-37767', '4-2018-10477'],
                                  'registrationNumbers': [], 'registrationType': 'trademark'}),
                text=True, capture_output=True, check=True,
            )
            matches = json.loads(result.stdout)['matches']
            self.assertEqual({item['applicationNo']: item['formatted'] for item in matches}, {
                '4-2018-37767': '4-0534068-000',
                '4-2018-10477': '4-0360843-000',
            })
            with closing(sqlite3.connect(history)) as db:
                self.assertEqual(db.execute('SELECT application_number FROM applications LIMIT 1').fetchone()[0],
                                 'VN-4-2018-37767')


if __name__ == '__main__':
    unittest.main()
