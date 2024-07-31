const config = {
    //BASE_URL : "http://wipopublish.ipvietnam.gov.vn/wopublish-search/public/ajax/detail/trademarks?id=",
    BASE_URL : "http://wipopublish.ipvietnam.gov.vn/wopublish-search/public/ajax/detail/patents?id=",
    DATA_TYPE : "TRADEMARK", // or "PATENT"
    path : {
     data : "ID_Trademark.csv",
     output : "result.txt",
     error : "error.txt",
     log : "log.txt"
    },
    RETRY_LIMIT : 15,
    TOTAL_REQUEST : 13,
    THREAD_COUNT : 13,
    delay : {
        BETWEEN_REQUEST : 2000
    },
    string : {
        INTERNAL_SERVER_ERROR : "An unexpected server error has occurred"
    }
}

module.exports = config;