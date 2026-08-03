import { workbookToSeries } from "../services/excel.js";

try {
  const list = await workbookToSeries(
    "C:\\Users\\45313\\Downloads\\updated_master(2)_renset.xlsx"
  );
  console.log("ok", list.length, list[0]?.["Seriens navn"]);
} catch (e) {
  console.error("fail", e.message);
}
