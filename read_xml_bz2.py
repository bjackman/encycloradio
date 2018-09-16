#!/usr/bin/python3
import logging
import random
import sys
from argparse import ArgumentParser
from bz2 import BZ2Decompressor, BZ2File
from io import StringIO, BytesIO

import mwxml # Parses the XML so we can get the MediaWiki source out
import mwparserfromhell # Parses the actual MediaWiki source
from progressbar import ProgressBar, UnknownLength

from index import WikipediaIndex

READ_SIZE = 64 * 1024

class WikipediaDump(object):
    def __init__(self, xml_bz2_file, index):
        self.logger = logging.getLogger(self.__class__.__name__)
        self._bz2_file = xml_bz2_file
        self.index = index

    def _iter_pages(self):
        """
        Iterate over every page in my .bz2 file

        Yields mwxml.Page objects.
        """
        # self._bz2_file.seek(0)
        dump = mwxml.Dump.from_file(BZ2File(self._bz2_file))
        for page in dump.pages:
            yield page

def find_listens(page):
    """
    Take a mwxml.Page and return all the "listen" templates

    Returned as an iterable of mwparserfromhell.Template objects. These should
    have a "filename" parameter.
    """
    # If you iterate over page objects you get each revision. We want the latest
    # revision. I guess that's the first thing yielded by the iterator (my data
    # only has single revisions..)
    mw = mwparserfromhell.parse(next(page).text)
    # Seems like the template names are messy hence .lower and startswith
    return (t for t in mw.filter_templates() if t.name.lower().startswith("listen"))

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    parser = ArgumentParser()
    parser.add_argument("xml_bz2_path")
    parser.add_argument("index_sqlite_path")

    args = parser.parse_args()

    index = WikipediaIndex.from_sqlite_path(args.index_sqlite_path)
    bz2_file = open(args.xml_bz2_path, "rb")
    wp_dump = WikipediaDump(bz2_file, index)

    num_pages = 0
    pages_with_listen = 0
    for page in wp_dump._iter_pages():
        num_pages += 1
        listens = find_listens(page)
        for listen in listens:
            filename = listen.get("filename").value.strip()
            # Not sure why mwparserfromhell gives me "\n" values on the
            # end. Strip em off.
            # TODO fix mwparserfromhell.
            if filename.endswith("\\n"):
                filename = filename[:-2]
            index_entry = index.find_page(page.title)
            if not index_entry:
                logging.warning("Couldn't find '{}' in index, skipping'"
                                .format(page.title))
            else:
                index.add_listen(index_entry.id, filename)

        if any(listens):
            pages_with_listen += 1
