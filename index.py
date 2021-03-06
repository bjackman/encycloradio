import logging
import sqlite3
from argparse import ArgumentParser
from collections import namedtuple

from progressbar import ProgressBar, UnknownLength

"""
Encapsulates the index provided with wikipedia dumps.

Run this as an executable script to convert the file into an SQLite DB; then you
can instantiate the provided class by passing that DB.
"""

IndexPageEntry = namedtuple("IndexPageEntry", ["id", "title", "seek_index"])

class WikipediaIndex(object):
    """
    Parses the index file that comes along with WP's .xml.bz page DB

    From https://en.wikipedia.org/wiki/Wikipedia:Database_download:

        Developers: for multistream you can get an index file,
        pages-articles-multistream-index.txt.bz2. The first field of this index
        is # of bytes to seek into the archive, the second is the article ID,
        the third the article title. If
    """

    def __init__(self, sqlite_connection):
        self.logger = logging.getLogger(self.__class__.__name__)

        self.conn = sqlite_connection
        self.c = self.conn.cursor()

        # TODO validate DB

    def get_seek_index(self, page_title):
        """
        Return the byte index to seek to to find the page with a given title
        """
        return self.find_page(page_title).seek_index

    def find_page(self, page_title):
        """
        Look up a page by title, return a IndexPageEntry
        """
        # I haven't properly normalised the titles.
        # Maybe I can get away with that by falling back to case-insensitive
        # search... very slow
        fmt = 'SELECT id, title, seek_index FROM pages WHERE title {} ?'
        results = list(self.c.execute(fmt.format('='), (page_title,)))
        if not results:
            self.logger.debug("Falling back to LIKE for '{}'".format(page_title))
            results = list(self.c.execute(fmt.format('LIKE'), (page_title,)))

        if not results:
            self.logger.debug("No title entry LIKE '{}'".format(page_title))
            return None

        if len(results) > 1:
            self.logger.warning("Found {} entries for '{}'".format(len(results),
                                                                   title))
        result = results[0]
        page_id, title, seek_index = result
        return IndexPageEntry(page_id, title, seek_index)

    def add_listen(self, page_id, filename):
        """Record that a page has a sound file associated with it"""
        self.logger.info("Adding listen {} - {}".format(page_id, filename))
        self.c.execute('INSERT INTO listens VALUES (?, ?)', (page_id, filename))
        self.conn.commit()

    @classmethod
    def from_sqlite_path(cls, path):
        """Set up an index based on an SQLite file"""
        connection = sqlite3.connect(path)
        return cls(connection)

    @classmethod
    def from_file_to_sqlite(cls, index_file, cursor):
        """
        Take an index file and dump it into an SQLite file.

        Doesn't return anything.
        Won't work if the DB is already populated.
        """
        logger = logging.getLogger(cls.__name__)

        # Attempt to create the tables now so we fail quickly if it's no worky
        c = cursor
        c.execute('CREATE TABLE pages (id integer, title text, seek_index integer)')
        c.execute('CREATE TABLE listens (page_id integer, title text)')

        # Read the index into memory, then parse, _then_ dump into SQLite. Only
        # real reason for this is that we get a pretty progress bar with an ETA
        # (need to know how many rows there are).
        # This is probably slower than streaming straight into SQLite would be,
        # but hey I'm just here to have fun.

        logger.info("Reading index file into memory...")
        rows = []
        progress_bar = ProgressBar()
        for line in progress_bar(index_file.readlines()):
            try:
                index, article_id, title = line.strip().split(":", 2)
            except ValueError:
                logger.error("Couldn't parse line: '{}'".format(line))
            else:
                rows.append((article_id, title, index))

        logger.info("Dumping index into SQLite DB")

        progress_bar = ProgressBar()
        c.executemany('INSERT INTO pages VALUES (?, ?, ?)',
                      progress_bar(rows))
        logger.info("Creating index")
        c.execute("CREATE INDEX tag_titles_idx ON pages (title)")

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    parser = ArgumentParser()
    parser.add_argument("index_path")

    args = parser.parse_args()

    connection = sqlite3.connect("index.sqlite")
    cursor = connection.cursor()

    with open(args.index_path) as f:
        WikipediaIndex.from_file_to_sqlite(f, cursor)

    logging.info("Writing DB to disk (no progress bar, just wait)")
    connection.commit()
    connection.close()
