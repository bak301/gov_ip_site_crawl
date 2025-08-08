const config = {
    //BASE_URL : "http://wipopublish.ipvietnam.gov.vn/wopublish-search/public/ajax/detail/trademarks?id=",
    BASE_URL : "http://wipopublish.ipvietnam.gov.vn/wopublish-search/public/ajax/detail/patents?id=",
    DATA_TYPE : "TRADEMARK", // or "PATENT"
    path : {
     data : "ID_Trademark.csv",
     output : "16.09.2024.txt",
     error : "error.txt",
     log : "log.txt"
    },
    RETRY_LIMIT : 10,
    TOTAL_REQUEST : 50,
    THREAD_COUNT : 10,
    delay : {
        BETWEEN_REQUEST : 500
    },
    string : {
        INTERNAL_SERVER_ERROR : "An unexpected server error has occurred"
    }
}

module.exports = config;