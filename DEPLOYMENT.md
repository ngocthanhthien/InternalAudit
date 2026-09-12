# Triển khai Internal Audit

- Website chính: https://ild-internal-audit-api.dangthanhbinh53.workers.dev
- Repository: https://github.com/ngocthanhthien/InternalAudit
- Worker: `ild-internal-audit-api`
- D1: `ild-internal-audit` (ID đã điền trong `wrangler.toml`)
- Realtime: Durable Object `SyncHub`, binding `SYNC_HUB`.

GitHub Pages là địa chỉ chuyển tiếp bằng liên kết và xuất dữ liệu cũ, không phải website có API. Dùng website Cloudflare để đăng nhập và làm việc.

Mã đã được triển khai bằng Wrangler từ máy quản trị. Chưa bật tự động triển khai sau mỗi GitHub push. Để cập nhật: `python build.py`, `npm test`, sau đó `npx wrangler deploy`.

Khóa ký phiên đăng nhập được đặt bằng Cloudflare Worker Secret `AUTH_SECRET`, không nằm trong repository. Cửa vào QA nằm trong bảng `users`; tài khoản Admin/Auditor/PIC nằm trong `members`. Bảng `member_defaults` lưu hash mật khẩu tạm theo nhóm. Không đăng mật khẩu, SQL tạo tài khoản hoặc bản backup dữ liệu vào repo.

Đã chuyển sang hai bước đăng nhập và khôi phục Admin, Admin2, QAM cùng 10 username Auditor hiện có. Dữ liệu Personnel hiện chưa có tên PIC; cần bổ sung tên hoặc nhập JSON danh mục cũ để tạo tài khoản Auditee. Nút Đổi người dùng giữ phiên QA, nút Thoát QA kết thúc cả hai lớp.

Lần đầu dùng app: đăng nhập tài khoản quản trị, nhập JSON từ app cũ, kiểm tra số liệu và chờ trạng thái Cloudflare xác nhận trước khi dùng trên máy thứ hai.

Cập nhật 2026-09-13: chỉ QA yêu cầu mật khẩu. Bước 2 chọn người dùng rồi vào; mật khẩu nội bộ đã lưu không còn được dùng để đăng nhập. Quyền vẫn lấy từ tài khoản được chọn.
