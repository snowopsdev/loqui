import { useTranslation } from "react-i18next";
import type { TableEntity } from "../../types/table";
import { TABLE_REF_MIME } from "./TableCanvas";
import { plainExcerpt, refKey } from "./tableModel";

export function TableInbox({
  entities,
  onPlace,
}: {
  entities: TableEntity[];
  onPlace: (key: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <aside className="table-inbox" aria-label={t("table.inbox.title")}>
      <h2 className="table-inbox__title">{t("table.inbox.title")}</h2>
      <p className="table-inbox__hint">{t("table.inbox.description")}</p>
      {entities.length === 0 ? (
        <p className="table-inbox__hint">{t("table.inbox.empty")}</p>
      ) : (
        <ul className="table-inbox__list">
          {entities.map((e) => {
            const key = refKey(e.ref);
            return (
              <li key={key}>
                <button
                  type="button"
                  draggable="true"
                  data-ref={key}
                  className="table-inbox__item"
                  onClick={() => onPlace(key)}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(TABLE_REF_MIME, key);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                >
                  <span className="table-inbox__kind">{t(`table.kind.${e.kind}`)}</span>
                  <span>{e.title?.trim() || plainExcerpt(e.excerpt, 90)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
