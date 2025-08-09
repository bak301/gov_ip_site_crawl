# WIPO Scraper Documentation / Tài liệu WIPO Scraper

## English Documentation

### Overview
The `index_Wipo.js` script is a high-performance web scraper designed to extract intellectual property data from the Vietnamese WIPO (World Intellectual Property Organization) database. It supports scraping Patents, Designs, and Trademarks with advanced retry mechanisms and comprehensive logging.

### Features
- **Multi-threaded Processing**: 12 concurrent threads for optimal performance
- **Smart Error Handling**: Distinguishes between server errors and actual data extraction failures
- **Two-tier Retry System**: Individual ID re-attempts (20 max) + Global retry passes (20 max)
- **Real-time Progress Tracking**: Dynamic console display with colored status indicators
- **Automatic Data Organization**: Separate files for Patents, Designs, and Trademarks
- **Duplicate Prevention**: Checks existing files to avoid re-scraping
- **Comprehensive Logging**: File logging with timestamps and performance metrics

### Prerequisites
1. **Node.js** (version 14 or higher)
2. **Required packages**: Install dependencies
   ```bash
   npm install
   ```
3. **Input file**: `ID_WIPO.txt` containing the IDs to scrape

### Installation & Setup

1. **Clone or download** the project files
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Prepare input file**: Create `ID_WIPO.txt` with one ID per line
   ```
   1-2021-04006
   2-2022-05123
   3-2023-01234
   4-2024-06789
   ```

### Usage

#### Basic Usage
```bash
node index_Wipo.js
```

#### Input File Format
The `ID_WIPO.txt` file should contain one ID per line:
- **Patents**: IDs starting with `1-` or `2-`
- **Designs**: IDs starting with `3-`
- **Trademarks**: IDs starting with `4-`

Example:
```
1-2021-04006
1-2022-03455
3-2023-01234
4-2024-06789
```

### Output Structure

The script creates organized output in the `Output/YYYY-MM-DD/` folder:

```
Output/
├── 2025-08-09/
│   ├── SC_WIPO_2025-08-09.txt     # Patents data
│   ├── KD_WIPO_2025-08-09.txt     # Designs data
│   ├── NH_WIPO_2025-08-09.txt     # Trademarks data
│   ├── log.txt                    # Processing log
│   ├── original_ID.csv            # Copy of input file
│   └── processing_report.txt      # Final statistics
```

### Configuration Options

Key settings in the script (lines 318-341):
```javascript
const config = {
  THREAD_COUNT: 12,              // Concurrent processing threads
  MAX_REATTEMPTS: 20,           // Individual ID retry attempts
  RETRY_LIMIT: 20,              // Global retry passes
  delay: {
    BETWEEN_REQUEST: 500        // Delay between requests (ms)
  }
};
```

### Understanding the Display

The script shows real-time progress with colored indicators:

```
 1/66: 1-2022-04531 [Retry 2] | Status: 500 - Internal Server Error    (Re-attempt 2/20)
🕒 23:46:38 09/08/2025 | Total: 3m 3s | Avg: 10.2s/ID (newly processed)
📈 Completed: 29/77 | ⏳ Processing: 12
⚙️ Config: 12 threads | 20 max re-attempts | 20 max retries | 500ms delay
```

**Color Coding**:
- 🟡 **Yellow**: ID numbers
- 🔵 **Cyan**: Retry passes
- 🔴 **Red**: Error status codes (500, 404, etc.)
- 🟢 **Green**: Success status codes (200)
- ⚫ **Gray**: Re-attempt indicators

### Performance Optimization

1. **Adjust thread count** based on your system:
   ```javascript
   THREAD_COUNT: 8,  // For slower systems
   THREAD_COUNT: 16, // For faster systems
   ```

2. **Modify delays** if getting rate-limited:
   ```javascript
   BETWEEN_REQUEST: 1000,  // Increase delay
   ```

3. **Reduce retry attempts** for faster processing:
   ```javascript
   MAX_REATTEMPTS: 10,
   RETRY_LIMIT: 10,
   ```

### Troubleshooting

**Common Issues**:

1. **"All IDs already processed"**
   - The script detected existing output files with the same IDs
   - Delete today's output folder to re-scrape

2. **Many 500 errors**
   - Server is overloaded, increase delays
   - The script will still extract usable data from 500 responses

3. **Script stops unexpectedly**
   - Check network connection
   - Restart script - it will resume from where it left off

4. **Out of memory errors**
   - Reduce `THREAD_COUNT`
   - Process smaller batches of IDs

### Output Data Format

Each output file is tab-separated with headers:

**Patents** (`SC_WIPO_*.txt`):
- ID, Image, Patent Type, Status, Dates, Applicants, Inventors, etc.

**Designs** (`KD_WIPO_*.txt`):
- ID, Image, Design Type, Status, Dates, Applicants, Authors, etc.

**Trademarks** (`NH_WIPO_*.txt`):
- ID, Image, Trademark Type, Status, Dates, Owners, Representatives, etc.

---

## Tài liệu Tiếng Việt

### Tổng quan
Script `index_Wipo.js` là một công cụ crawl web hiệu suất cao được thiết kế để trích xuất dữ liệu sở hữu trí tuệ từ cơ sở dữ liệu WIPO Việt Nam. Hỗ trợ crawl Bằng sáng chế, Kiểu dáng công nghiệp và Nhãn hiệu với cơ chế retry tiên tiến và ghi log toàn diện.

### Tính năng
- **Xử lý đa luồng**: 12 luồng đồng thời để tối ưu hiệu suất
- **Xử lý lỗi thông minh**: Phân biệt giữa lỗi server và lỗi trích xuất dữ liệu thực tế
- **Hệ thống retry 2 tầng**: Thử lại ID cá nhân (tối đa 20) + Thử lại toàn cục (tối đa 20)
- **Theo dõi tiến trình thời gian thực**: Hiển thị console động với chỉ báo màu sắc
- **Tự động tổ chức dữ liệu**: File riêng cho Bằng sáng chế, Kiểu dáng và Nhãn hiệu
- **Ngăn chặn trùng lặp**: Kiểm tra file hiện có để tránh crawl lại
- **Ghi log toàn diện**: Ghi log file với timestamp và metrics hiệu suất

### Yêu cầu hệ thống
1. **Node.js** (phiên bản 14 trở lên)
2. **Các package cần thiết**: Cài đặt dependencies
   ```bash
   npm install
   ```
3. **File đầu vào**: `ID_WIPO.txt` chứa các ID cần crawl

### Cài đặt & Thiết lập

1. **Clone hoặc tải xuống** các file dự án
2. **Cài đặt dependencies**:
   ```bash
   npm install
   ```
3. **Chuẩn bị file đầu vào**: Tạo `ID_WIPO.txt` với mỗi ID trên một dòng
   ```
   1-2021-04006
   2-2022-05123
   3-2023-01234
   4-2024-06789
   ```

### Cách sử dụng

#### Sử dụng cơ bản
```bash
node index_Wipo.js
```

#### Định dạng file đầu vào
File `ID_WIPO.txt` phải chứa một ID trên mỗi dòng:
- **Bằng sáng chế**: ID bắt đầu bằng `1-` hoặc `2-`
- **Kiểu dáng**: ID bắt đầu bằng `3-`
- **Nhãn hiệu**: ID bắt đầu bằng `4-`

Ví dụ:
```
1-2021-04006
1-2022-03455
3-2023-01234
4-2024-06789
```

### Cấu trúc đầu ra

Script tạo đầu ra có tổ chức trong thư mục `Output/YYYY-MM-DD/`:

```
Output/
├── 2025-08-09/
│   ├── SC_WIPO_2025-08-09.txt     # Dữ liệu Bằng sáng chế
│   ├── KD_WIPO_2025-08-09.txt     # Dữ liệu Kiểu dáng
│   ├── NH_WIPO_2025-08-09.txt     # Dữ liệu Nhãn hiệu
│   ├── log.txt                    # Log xử lý
│   ├── original_ID.csv            # Bản sao file đầu vào
│   └── processing_report.txt      # Thống kê cuối cùng
```

### Tùy chọn cấu hình

Các thiết lập chính trong script (dòng 318-341):
```javascript
const config = {
  THREAD_COUNT: 12,              // Số luồng xử lý đồng thời
  MAX_REATTEMPTS: 20,           // Số lần thử lại ID cá nhân
  RETRY_LIMIT: 20,              // Số lần thử lại toàn cục
  delay: {
    BETWEEN_REQUEST: 500        // Độ trễ giữa các request (ms)
  }
};
```

### Hiểu về màn hình hiển thị

Script hiển thị tiến trình thời gian thực với chỉ báo màu sắc:

```
 1/66: 1-2022-04531 [Retry 2] | Status: 500 - Internal Server Error    (Re-attempt 2/20)
🕒 23:46:38 09/08/2025 | Total: 3m 3s | Avg: 10.2s/ID (newly processed)
📈 Completed: 29/77 | ⏳ Processing: 12
⚙️ Config: 12 threads | 20 max re-attempts | 20 max retries | 500ms delay
```

**Mã màu**:
- 🟡 **Vàng**: Số ID
- 🔵 **Xanh dương**: Lần thử lại
- 🔴 **Đỏ**: Mã lỗi status (500, 404, v.v.)
- 🟢 **Xanh lá**: Mã thành công (200)
- ⚫ **Xám**: Chỉ báo thử lại

### Tối ưu hiệu suất

1. **Điều chỉnh số luồng** dựa trên hệ thống:
   ```javascript
   THREAD_COUNT: 8,  // Cho hệ thống chậm
   THREAD_COUNT: 16, // Cho hệ thống nhanh
   ```

2. **Sửa đổi độ trễ** nếu bị giới hạn tốc độ:
   ```javascript
   BETWEEN_REQUEST: 1000,  // Tăng độ trễ
   ```

3. **Giảm số lần thử lại** để xử lý nhanh hơn:
   ```javascript
   MAX_REATTEMPTS: 10,
   RETRY_LIMIT: 10,
   ```

### Khắc phục sự cố

**Vấn đề thường gặp**:

1. **"All IDs already processed"**
   - Script phát hiện file đầu ra hiện có với cùng ID
   - Xóa thư mục output hôm nay để crawl lại

2. **Nhiều lỗi 500**
   - Server quá tải, tăng độ trễ
   - Script vẫn sẽ trích xuất dữ liệu có thể sử dụng từ response 500

3. **Script dừng đột ngột**
   - Kiểm tra kết nối mạng
   - Khởi động lại script - nó sẽ tiếp tục từ nơi đã dừng

4. **Lỗi hết bộ nhớ**
   - Giảm `THREAD_COUNT`
   - Xử lý batch ID nhỏ hơn

### Định dạng dữ liệu đầu ra

Mỗi file đầu ra được phân tách bằng tab với header:

**Bằng sáng chế** (`SC_WIPO_*.txt`):
- ID, Hình ảnh, Loại bằng, Trạng thái, Ngày tháng, Chủ đơn, Tác giả, v.v.

**Kiểu dáng** (`KD_WIPO_*.txt`):
- ID, Hình ảnh, Loại kiểu dáng, Trạng thái, Ngày tháng, Chủ đơn, Tác giả, v.v.

**Nhãn hiệu** (`NH_WIPO_*.txt`):
- ID, Hình ảnh, Loại nhãn hiệu, Trạng thái, Ngày tháng, Chủ sở hữu, Đại diện, v.v.

---

## Advanced Usage / Sử dụng nâng cao

### Custom Configuration / Cấu hình tùy chỉnh

You can modify the configuration directly in the script:

```javascript
// Modify these values based on your needs
const config = {
  THREAD_COUNT: 12,              // Reduce for slower systems
  MAX_REATTEMPTS: 20,           // Max retries per individual ID
  RETRY_LIMIT: 20,              // Max global retry passes
  delay: {
    BETWEEN_REQUEST: 500,       // Delay between requests (ms)
    RETRY_DELAY_BASE: 400,      // Base delay for retries
    RETRY_DELAY_MULTIPLIER: 1.5 // Exponential backoff multiplier
  }
};
```

### Monitoring Progress / Theo dõi tiến trình

The script provides several ways to monitor progress:

1. **Real-time console display** with color-coded status
2. **Log file** in `Output/YYYY-MM-DD/log.txt`
3. **Global tracking file** `WIPO_Global_Tracking.txt`
4. **Final report** in `Output/YYYY-MM-DD/processing_report.txt`

### Data Recovery / Khôi phục dữ liệu

If the script is interrupted:
1. Simply restart it with `node index_Wipo.js`
2. It automatically detects already processed IDs
3. Continues from where it left off
4. No data is lost or duplicated

---

## Support / Hỗ trợ

For issues or questions:
1. Check the troubleshooting section above
2. Review the log files for error details
3. Ensure proper input file format
4. Verify network connectivity

---

**Note**: This script is designed specifically for the Vietnamese WIPO database and may not work with other IP databases without modification.

**Lưu ý**: Script này được thiết kế đặc biệt cho cơ sở dữ liệu WIPO Việt Nam và có thể không hoạt động với các cơ sở dữ liệu IP khác mà không cần sửa đổi.
