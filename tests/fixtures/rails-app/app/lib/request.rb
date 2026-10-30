class Request
  def perform
    HTTP.timeout(10).post(@url, body: @body)
  end
end
