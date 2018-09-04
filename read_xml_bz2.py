#!/usr/bin/python3
import logging
import random
import sys
from argparse import ArgumentParser
from bz2 import BZ2Decompressor
from io import StringIO

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

        self._xml_header = self._extract_bz2_stream(0)
        self._xml_footer = "</mediawiki>"

    def _iter_bz2_streams(self, start_index):
        """
        Iterate over the streams in my .bz2 file, starting at start_index

        Yields each stream decompressed in its entirety. This is useful because
        Wikipedia XML dumps are enormous .bz2 files but divided into individual
        streams that can be decompressed separately.
        """
        self._bz2_file.seek(start_index)

        decompressor = BZ2Decompressor()
        unused_data = b""
        decompressed = b""

        while True:
            compressed = unused_data + self._bz2_file.read(READ_SIZE)
            unused_data = b""
            decompressed += decompressor.decompress(compressed)

            if decompressor.eof: # Reached end of bz2 stream
                yield decompressed

                # The decompressor is dead now, need a new one for the next
                # stream.  It will generally have hit the bz2 EOF before the end
                # of the buffer we passed it; the remaining part of the buffer
                # is in .unused_data. We'll pass that on to the new
                # decompressor.
                decompressed = b""
                unused_data = decompressor.unused_data
                decompressor = BZ2Decompressor()

    def _extract_bz2_stream(self, start_index):
        """
        Extract the stream starting at @start_index bytes into my .bz2 file

        Returns the whole thing at once (they aren't too big).
        """
        return next(self._iter_bz2_streams(start_index)).decode("utf-8")

    def _iter_stream_pages(self, stream):
        """
        Take a decompressed stream and iterate over pages

        Takes a stream decompressed from .bz2 as yielded by _iter_bz2_streams.
        Yields mwxml.Page objects.
        """
        # mw_file = mwtypes.files.concat(self._xml_header, stream, self._xml_footer)
        mw_file = StringIO(self._xml_header + stream + self._xml_footer)
        dump = mwxml.Dump.from_file(mw_file)

        for page in dump.pages:
            yield page

    def find_page(self, title):
        seek_index = self.index.get_seek_index(title)
        stream = self._extract_bz2_stream(seek_index)
        for page in self._iter_stream_pages(stream):
            if page.title.lower() == title.lower():
                mw = mwparserfromhell.parse(next(page).text)
                return mw
        raise RuntimeError("Failed to find page with title '{}'".format(title))

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

    title = "United States general election, 1789"
    # title = "AynRand"
    # title = "Buddhist"
    # title = "Philosophy"
    while True:
        print(title)
        page = wp_dump.find_page(title)

        wikilinks = page.filter_wikilinks()
        wikilinks = [l for l in wikilinks if ':' not in l.title]

        title = str(wikilinks[random.randint(0, len(wikilinks) - 1)].title)
        title = title.split('#', 1)[0]
