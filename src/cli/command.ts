export interface Command {
    name: string;
    aliases?: string[];
    /** Левая колонка общей справки, например `view <iid>`. */
    synopsis: string;
    summary: string;
    /** Функция, потому что часть справок подставляет пути и списки полей. */
    help: () => string;
    run: (args: string[]) => Promise<void>;
}
