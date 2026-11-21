// Firefox: page title + domain from the window title (plan §9.3, ADR-0007). Patterns come from the DB.
import { parseFirefoxTitle, type FirefoxPage, type TitlePattern } from '../../core/titlePatterns';
import type { Db } from '../db/db';
import { loadTitlePatterns } from '../db/repo';

export class FirefoxTitles {
  private patterns: TitlePattern[];
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
    this.patterns = loadTitlePatterns(db);
  }

  reload(): void {
    this.patterns = loadTitlePatterns(this.db);
  }

  parse(windowTitle: string): FirefoxPage {
    return parseFirefoxTitle(windowTitle, this.patterns);
  }
}
