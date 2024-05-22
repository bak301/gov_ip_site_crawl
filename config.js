const config = {
    BASE_URL : "http://wipopublish.ipvietnam.gov.vn/wopublish-search/public/ajax/detail/trademarks?id=",
    path : {
     data : "ID_Trademark.csv",
     output : "result.txt",
     error : "error.txt",
     log : "log.txt"
    },
    RETRY_LIMIT : 3,
    TOTAL_REQUEST : 5,
    THREAD_COUNT : 1,
    delay : {
        BETWEEN_REQUEST : 200
    },
    string : {
        INTERNAL_SERVER_ERROR : "An unexpected server error has occurred"
    }
}

module.exports = config;