#!/usr/bin/python3
import logging
import os
import pickle
import sys
from argparse import ArgumentParser
from bz2 import BZ2Decompressor
from io import StringIO

import mwxml # Parses the XML so we can get the MediaWiki source out
import mwparserfromhell # Parses the actual MediaWiki source
from progressbar import ProgressBar, UnknownLength

READ_SIZE = 64 * 1024

def iter_xml_bz2_streams(bz2_file):
    """
    Take a MediaWiki .xml.bz2 file and iterate over the streams

    Yields each stream decompressed in its entirety. This is useful because
    Wikipedia XML dumps are enormous .bz2 files but divided into individual
    streams that can be decompressed separately.
    """
    decompressor = BZ2Decompressor()
    unused_data = b""
    decompressed = b""

    while True:
        compressed = unused_data + bz2_file.read(READ_SIZE)
        unused_data = b""
        decompressed += decompressor.decompress(compressed)

        if decompressor.eof: # Reached end of bz2 stream
            yield decompressed

            # The decompressor is dead now, need a new one for the next stream.
            # It will generally have hit the bz2 EOF before the end of the
            # buffer we passed it; the remaining part of the buffer is in
            # .unused_data. We'll pass that on to the new decompressor.
            decompressed = b""
            unused_data = decompressor.unused_data
            decompressor = BZ2Decompressor()

def iter_pages(bz2_file):
    """
    Take a MediaWiki .xml.bz2 file and iterate over wiki pages

    Yields mwxml.Page objects
    """
    for decomp_stream in iter_xml_bz2_streams(bz2_file):
        dump = mwxml.Dump.from_page_xml(StringIO(str(decomp_stream)))
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

class WikipediaIndex(object):
    """
    Parses the index file that comes along with WP's .xml.bz page DB

    From https://en.wikipedia.org/wiki/Wikipedia:Database_download:

        Developers: for multistream you can get an index file,
        pages-articles-multistream-index.txt.bz2. The first field of this index
        is # of bytes to seek into the archive, the second is the article ID,
        the third the article title. If
    """

    def __init__(self, seek_indices):
        self.seek_indices = seek_indices

    @classmethod
    def from_file(cls, index_file):
        """Parse from a file object"""
        logger = logging.getLogger(cls.__name__)
        logger.info("Parsing index from file")

        indices = {}
        with ProgressBar(max_value=UnknownLength) as progress_bar:
            for i, line in enumerate(index_file):
                try:
                    index, article_id, title = line.strip().split(":", 2)
                except ValueError:
                    logger.error("Couldn't parse line: '{}'".format(line))
                else:
                    indices[title] = index
                    progress_bar.update(i)

        logger.info("Finished parsing index")
        return cls(indices)

    @classmethod
    def from_path(cls, path, enable_pickle_cache=True):
        """
        Get from a path

        Implements ridiculous caching with "pickle" because I am too rushed to
        do this with SQLite or something.
        """
        logger = logging.getLogger(cls.__name__)

        pickle_path = "{}.pickle".format(path)
        if enable_pickle_cache and os.path.exists(pickle_path):
            logger.info("Loading index from pickle cache at {}".format(pickle_path))
            with open(pickle_path) as f:
                obj = pickle.load(f)
            if isinstance(obj, cls):
                return cls
            else:
                logger.error("Pickled object had a weird class: {}"
                             .formast(obj.__class__))

        with open(path) as f:
            obj = cls.from_file(f)

        if enable_pickle_cache:
            logger.info("[Over]writing index pickle cache at {}".format(pickle_path))
            with open(pickle_path, "wb") as f:
                pickle.dump(obj, f)

        return obj

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    parser = ArgumentParser()
    parser.add_argument("xml_bz2_path")
    parser.add_argument("index_path")

    args = parser.parse_args()

    index = WikipediaIndex.from_path(args.index_path)

    bz2_file = open(args.xml_bz2_path, "rb")

    #
    # TODO hard-coded seek here!
    # Plan is to use index file from dump to seek to streams to reach pages
    # without decompressing entire XML
    #

    bz2_file.seek(1619327860)

    for page in iter_pages(bz2_file):
        for listen in find_listens(page):
            print("On page '{}', found file '{}'".format(
                page.title, listen.get("filename").value))
