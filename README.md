# ILD Internal Audit — Cloudflare

Bản chuyển đổi từ `ILD-Internal Audit.html`. Frontend: `index.html`. GitHub lưu mã nguồn; Cloudflare Workers phục vụ website và API, D1 lưu dữ liệu, Durable Object thông báo realtime qua WebSocket. Không cần GitHub Pages.

## Đã thay đổi

- Lưu bản dữ liệu đang làm và phiên bản server đã nhận trong cùng transaction IndexedDB. Chỉ báo cloud đã xác nhận sau khi API ghi thành công.
- Tự gửi sau khoảng 500 ms kể từ thao tác **Lưu**, tự thử lại với thời gian chờ tăng dần khi lỗi mạng. WebSocket thông báo máy khác tải bản mới; kiểm tra dự phòng mỗi 30 giây.
- Kiểm tra phiên bản nguyên tử trên D1. Máy giữ phiên bản cũ không thể ghi đè bản mới. Nếu phản hồi thành công bị mất giữa đường, lần thử lại lấy phiên bản server và gộp lại.
- Gộp ba bản (bản chung trước đó, bản trên máy, bản server), theo từng trường và ID bản ghi. Xóa–sửa cùng bản ghi hoặc sửa cùng trường khác giá trị phải chọn. Bảng xung đột cho tải cả hai bản; lựa chọn áp dụng cho **tất cả mục xung đột đang hiển thị**. Các thay đổi không xung đột vẫn được giữ.
- Khi có dữ liệu mới, trạng thái cập nhật ngay. Nút cập nhật giao diện cho phép chủ động vẽ lại màn hình, tránh mất nội dung form đang nhập.
- Database giữ 20 phiên bản gần nhất. Dữ liệu JSON được chia nhỏ để tránh giới hạn kích thước một hàng của D1; bản này giới hạn tổng request 8 MB. Với nhiều ảnh cần mở rộng lưu ảnh R2.
- Chỉ một tab được quyền chỉnh sửa trên cùng trình duyệt/origin, tránh hai tab ghi đè IndexedDB.
- Bỏ đăng nhập bằng mật khẩu cố định trong HTML. Mật khẩu băm PBKDF2 ở D1; phiên đăng nhập ký HMAC, hết hạn sau 8 giờ. Kiểm tra tài khoản còn hoạt động trên mỗi API.
- Service worker lưu giao diện để mở lại khi mất mạng sau lần truy cập online và cài cache thành công; không cache API.

## Tài khoản — Admin / Auditor / PIC như app cũ

Đăng nhập hai bước: **QA** chỉ mở danh sách người dùng; tiếp theo chỉ chọn **Admin / Auditor / PIC** rồi bấm **Vào app**, không nhập mật khẩu lần hai. Người biết mật khẩu QA có thể chọn bất kỳ tài khoản đang hoạt động, kể cả Admin. Token QA không được đọc/ghi dữ liệu đánh giá hoặc quản lý tài khoản. Quyền thực tế lấy từ bảng `members`, không lấy từ tài khoản QA ở bảng `users`. Các phiên đăng nhập từ bản một bước sẽ cần đăng nhập lại.

- `admin`: cấu hình, danh mục, phê duyệt, dữ liệu đánh giá.
- `auditor` (Auditor): nhập đánh giá/Finding, tạo request Verification, cập nhật Action/PIC/Due Date/Remarks và gửi Pending. Tên auditor được điền sẵn khi đăng nhập. Chỉ Admin sửa nội dung đánh giá đã lưu, phê duyệt, Done, mở lại/xóa dữ liệu và quản lý danh mục.
- `auditee` (PIC): giữ quyền thao tác không-Admin giống app cũ, gồm tạo request/Finding, nhập đánh giá và cập nhật/gửi CAPA. Giao diện hiển thị **PIC**; công cụ tạo tài khoản chấp nhận tên vai trò `pic` và lưu thành `auditee` để tương thích mã cũ.

App cũ chưa giới hạn mỗi PIC chỉ được sửa dữ liệu của riêng mình; bản chuyển đổi giữ nguyên phạm vi đó. Auditor/PIC không được sửa bản ghi Done hoặc tự mở lại. Đánh dấu Verification hoàn tất phải đi kèm kết quả chấm điểm mới; duyệt/lên lịch/mở lại Verification vẫn thuộc Admin. Quyền được đọc từ database ở mỗi API, không tin trường admin/role do trình duyệt gửi lên.

Danh mục Auditor/PIC và tài khoản đăng nhập là hai dữ liệu riêng. Trong **Personnel → Tài khoản nội bộ**, Admin có thể nhập username từ JSON cũ hoặc tạo/cập nhật từng tài khoản. Nhập JSON áp dụng mật khẩu tạm theo nhóm được cấu hình riêng ở D1, không mang mật khẩu plaintext vào dữ liệu đánh giá. Để trống mật khẩu khi tạo Auditor/PIC sẽ dùng mật khẩu theo nhóm; Admin phải nhập mật khẩu riêng. Không có tên PIC thì không tạo username giả. Tên hiển thị auditor nên trùng danh mục.

Ví dụ tạo tài khoản: `python provision-user.py auditor01 "Tên Auditor trong danh mục" auditor` hoặc `python provision-user.py pic01 "Tên PIC trong danh mục" pic`. Tài khoản Admin dùng tham số `admin`. Mật khẩu mới được nhập ẩn trên máy, không cần gửi qua chat.

Nếu đã tạo database theo bản sơ bộ `editor/viewer`, sao lưu trước và áp dụng `migrations/001-account-roles.sql` một lần để đổi cấu trúc bảng users. Các tài khoản admin được giữ; tài khoản editor/viewer cũ bị vô hiệu hóa để Admin gán đúng vai trò và kích hoạt lại. Không tự chuyển người chỉ-xem thành người được ghi dữ liệu. Database tạo mới chỉ cần `schema.sql`, không chạy file chuyển đổi này.

## Triển khai

1. Tạo GitHub repository **private** vì mã nguồn vẫn chứa chủ điểm/SOP và danh mục mẫu nội bộ. Đưa thư mục này lên repo; `.gitignore` loại dữ liệu local và tài khoản. Không đưa file HTML gốc còn mật khẩu cũ hoặc backup dữ liệu lên GitHub.
2. Cài Node.js, Python và chạy `npm install`, sau đó `python build.py`. Lưu `package-lock.json` vào GitHub sau khi cài để cố định phiên bản công cụ.
3. Đăng nhập Cloudflare bằng `npx wrangler login`.
4. Tạo D1 riêng: `npx wrangler d1 create ild-internal-audit`. Điền database_id trả về vào `wrangler.toml`. Không dùng database của DOR/WOR.
5. Tạo bảng: `npx wrangler d1 execute ild-internal-audit --remote --file=schema.sql`.
6. Đặt khóa bí mật ngẫu nhiên tối thiểu 32 ký tự qua `npx wrangler secret put AUTH_SECRET`. Không đưa khóa vào HTML, GitHub hoặc wrangler.toml.
7. Khi cài mới: tạo cửa vào bằng `python provision-user.py QA QA admin --gate`, và tạo tài khoản Admin nội bộ bằng `python provision-user.py Admin "Tên quản trị" admin`. Công cụ ghi SQL vào `accounts.sql` (git-ignored). Áp dụng bằng `npx wrangler d1 execute ild-internal-audit --remote --file=accounts.sql`. Mỗi file chỉ áp dụng một lần. Với database đang dùng bản một bước, chỉ áp dụng `migrations/002-two-stage-login.sql` rồi chuyển tài khoản nội bộ; tài khoản QA hiện tại được giữ nguyên.
8. Chạy kiểm thử `npm test` và kiểm tra cấu hình bằng `npx wrangler deploy --dry-run` trước khi triển khai.
9. Deploy bằng `npx wrangler deploy`. Mở URL Worker trả về, đăng nhập admin để khởi tạo dữ liệu. Website và API cùng origin; không cần cấu hình CORS nếu không dùng domain khác.
10. Có thể kết nối repo ở Cloudflare Workers Builds: build command `python build.py`, deploy command `npx wrangler deploy`. Nếu môi trường build không có Python, build local rồi commit cả `public/index.html`; bỏ build command. `public` là thư mục duy nhất được phục vụ công khai.

Để tự kiểm tra trước khi deploy: cài dependency, tạo `.dev.vars` với AUTH_SECRET thử nghiệm; chạy schema/tài khoản với `--local`, sau đó `npm run dev`. Không commit `.dev.vars`.

## Chuyển dữ liệu đang dùng

1. Mở app cũ trên máy đang có dữ liệu mới nhất. Đồng bộ thư mục cũ nếu còn nhiều máy; xuất Backup JSON và giữ riêng một bản dự phòng.
2. Đăng nhập admin vào website mới. Dùng **Nhập JSON cũ** ở thanh Cloudflare Sync. Mật khẩu trong backup không được chuyển thành tài khoản cloud.
3. Chờ trạng thái “Đã được Cloudflare xác nhận”. Kiểm tra số đánh giá, Verification, Master Plan, Personnel và phê duyệt.
4. Đăng nhập website mới trên máy thứ hai và đối chiếu. Chỉ chuyển sang sử dụng chính thức sau khi đối chiếu xong; ngừng sửa trên app cũ để tránh tạo hai luồng dữ liệu.

Chỉ copy HTML không chuyển được IndexedDB. `file://`, địa chỉ local và địa chỉ Cloudflare có vùng dữ liệu trình duyệt riêng. App mới cần phục vụ bằng HTTPS hoặc localhost, không mở trực tiếp `file://`.

## Giới hạn cần biết

- “Đã lưu trên máy” khác “Đã được Cloudflare xác nhận”. Chỉ dữ liệu đã nhấn Lưu mới vào journal; form đang gõ chưa lưu không được đảm bảo khôi phục khi đóng trang. Không có bảo đảm mất dữ liệu bằng 0 nếu xóa dữ liệu trình duyệt/hỏng thiết bị trước khi gửi cloud.
- Phải kiểm thử tích hợp trên tài khoản Cloudflare thật trước khi sử dụng chính thức. Bộ test local không kiểm chứng mạng, giới hạn gói, hay cấu hình domain thực tế.
- Bản này đồng bộ snapshot toàn bộ dữ liệu (đã chia hàng khi lưu D1), không phải từng ảnh/record qua mạng. Với dữ liệu lớn cần chuyển sang API thao tác từng record + R2.
- 20 phiên bản là cửa sổ khôi phục ngắn, không thay thế backup định kỳ. Có thể xuất D1 bằng `npx wrangler d1 export ild-internal-audit --remote --output=backup.sql`; giữ ngoài GitHub. Cloudflare D1 cũng có Time Travel theo gói.
- Logout giữ dữ liệu offline trên trình duyệt. Chỉ dùng trên thiết bị nội bộ được tin cậy; chưa có mã hóa cache cục bộ theo tài khoản.

## Khôi phục phiên bản

Truy vấn `SELECT version,created_at,actor FROM versions ORDER BY created_at DESC` trong D1 để xem các bản. Ghép cột `data` ở bảng `chunks` theo `part` của phiên bản cần khôi phục để được JSON. Sao lưu hiện trạng trước khi thao tác. Chưa có giao diện chọn lịch sử; không sửa `head` thủ công khi có người đang làm việc.

## Cấu trúc và kiểm thử

- `app-template.html`: giao diện/nghiệp vụ gốc đã chỉnh đăng nhập, lưu local và tích hợp cloud.
- `sync-core.js`: thuật toán gộp thuần, có kiểm thử xung đột.
- `cloud-client.js`: journal, API, WebSocket, retry, UI trạng thái.
- `build.py`: nhúng module vào `index.html`, copy sang `public/index.html`.
- `worker.js`, `schema.sql`, `wrangler.toml`: backend và cấu hình.
- `test/*.test.mjs`: kiểm thử thuật toán, quyền, token và SQLite qua adapter API.
- `test/browser.mjs`: hai Chrome context với API giả lập. Cần Playwright và đường dẫn Chrome; có thể đặt biến `AUDIT_PLAYWRIGHT_PATH` chỉ đến package Playwright trên máy kiểm thử.

Tài liệu chính thức: [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [WebSocket Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).
