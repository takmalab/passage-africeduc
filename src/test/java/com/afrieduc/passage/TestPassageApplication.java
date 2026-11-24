package com.afrieduc.passage;

import org.springframework.boot.SpringApplication;

public class TestPassageApplication {

	public static void main(String[] args) {
		SpringApplication.from(PassageApplication::main).with(TestcontainersConfiguration.class).run(args);
	}

}
